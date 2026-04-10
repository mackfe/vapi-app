import sip from 'sip';
import { createAuthHeader } from './SipUtils.js';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { RtpManager } from './RtpManager.js';
import { getLocalIp } from '../utils/network.js';
import { AiPipeline } from '../ai/Pipeline.js';
import { FishAudioClient } from '../ai/FishAudioClient.js';

dotenv.config();

const config = {
  user: process.env.SIP_USER,
  password: process.env.SIP_PASS,
  domain: process.env.SIP_DOMAIN,
};

export class SipManager {
  private sipStack: any;
  private callId: string = uuidv4();
  private isRegistered: boolean = false;
  private rtp: RtpManager | null = null;
  private ai: AiPipeline;
  private tts: FishAudioClient;
  private io: any;

  constructor(io?: any) {
    this.sipStack = sip;
    this.ai = new AiPipeline();
    this.tts = new FishAudioClient();
    this.io = io;
  }

  public async start() {
    console.log(`[SIP] Iniciando registro para ${config.user}@${config.domain}...`);
    
    const options = {
      port: 5060,
      hostname: '0.0.0.0',
    };

    try {
      this.sipStack.start(options, (request: any) => {
        this.handleRequest(request);
      });

      this.register();
    } catch (error) {
      console.error('[SIP] Error al iniciar stack:', error);
    }
  }

  private register() {
    const localIp = getLocalIp();
    const contact = { uri: `sip:${config.user}@${localIp}:5060` };
    
    const request = {
      method: 'REGISTER',
      uri: `sip:${config.domain}`,
      headers: {
        to: { uri: `sip:${config.user}@${config.domain}` },
        from: { uri: `sip:${config.user}@${config.domain}`, params: { tag: uuidv4() } },
        'call-id': this.callId,
        cseq: { method: 'REGISTER', seq: Math.floor(Math.random() * 1000) },
        contact: [contact],
        'max-forwards': 70,
      },
    };

    this.sipStack.send(request, (response: any) => {
      if (response.status === 200) {
        this.isRegistered = true;
        console.log('[SIP] Registro EXITOSO.');
      } else if (response.status === 401 || response.status === 407) {
        const authHeaderStr = response.headers['www-authenticate'] || response.headers['proxy-authenticate'];
        if (authHeaderStr) {
          const authHeader = createAuthHeader('REGISTER', request.uri, authHeaderStr, config.user!, config.password!);
          const authenticatedRequest = {
            ...request,
            headers: {
              ...request.headers,
              authorization: authHeader,
              cseq: { method: 'REGISTER', seq: request.headers.cseq.seq + 1 }
            }
          };
          this.sipStack.send(authenticatedRequest, (authResponse: any) => {
            if (authResponse.status === 200) {
              this.isRegistered = true;
              console.log('[SIP] Registro EXITOSO (con Auth).');
            } else {
              if (this.io) this.io.emit('sip-error', { 
                message: 'Fallo de autenticación SIP', 
                status: authResponse.status 
              });
            }
          });
        }
      } else if (response.status >= 400) {
        if (this.io) this.io.emit('sip-error', { 
          message: 'Error de respuesta del servidor SIP', 
          status: response.status 
        });
      }
    });
  }

  private handleRequest(request: any) {
    if (request.method === 'INVITE') {
      this.handleInvite(request);
    } else if (request.method === 'BYE') {
      this.handleBye(request);
    }
  }

  private async handleInvite(request: any) {
    console.log('[SIP] ¡Llamada entrante detectada!');
    this.sipStack.send(this.sipStack.makeResponse(request, 180, 'Ringing'));
    
    // Configurar RTP
    const localIp = getLocalIp();
    this.rtp = new RtpManager();
    await this.rtp.start();

    const sdp = [
      'v=0',
      `o=- ${Date.now()} ${Date.now()} IN IP4 ${localIp}`,
      's=-',
      `c=IN IP4 ${localIp}`,
      't=0 0',
      `m=audio ${this.rtp.getPort()} RTP/AVP 0`,
      'a=rtpmap:0 PCMU/8000',
      'a=sendrecv',
    ].join('\r\n') + '\r\n';

    const response = this.sipStack.makeResponse(request, 200, 'OK');
    response.headers.contact = [{ uri: `sip:${config.user}@${localIp}:5060` }];
    response.headers['content-type'] = 'application/sdp';
    response.content = sdp;

    this.sipStack.send(response);
    
    // Extraer Caller ID del encabezado From
    const callerUri = request.headers.from.uri;
    const callerId = callerUri.split(':')[1]?.split('@')[0] || 'Desconocido';
    
    console.log(`[SIP] Llamada aceptada de: ${callerId}`);
    if (this.io) this.io.emit('call-started', { callerId });

    // Estado para manejo de voz
    let audioBuffer = Buffer.alloc(0);
    let silenceTimer: NodeJS.Timeout | null = null;

    this.rtp.on('audio', async (data) => {
      // Emitir audio al dashboard para monitoreo (en chunks pequeños)
      if (this.io) this.io.emit('audio-chunk', data);
      
      audioBuffer = Buffer.concat([audioBuffer, data]);
      
      if (silenceTimer) clearTimeout(silenceTimer);
      
      silenceTimer = setTimeout(async () => {
        if (audioBuffer.length > 8000) {
          const currentBuffer = audioBuffer;
          audioBuffer = Buffer.alloc(0);
          
          const text = await this.ai.getTranscription(currentBuffer);
          
          if (text && text.trim().length > 1) {
            if (this.io) this.io.emit('transcription', `Vecino: ${text}`);
            
            const response = await this.ai.getAiResponse(text);
            if (this.io) this.io.emit('transcription', `IA: ${response}`);
            
            const audioResponse = await this.tts.textToSpeech(response);
            
            // Emitir respuesta de la IA al dashboard para monitoreo
            if (this.io) this.io.emit('audio-chunk', audioResponse);
            
            if (this.rtp) this.rtp.sendAudio(audioResponse);
          }
        }
      }, 1500);
    });

    // Mensaje de bienvenida inicial
    setTimeout(async () => {
      const welcome = "Hola, bienvenido a la línea de atención del Municipio de 3 de Febrero. ¿En qué puedo ayudarte con el tema de podas o árboles?";
      if (this.io) this.io.emit('transcription', `IA: ${welcome}`);
      const audio = await this.tts.textToSpeech(welcome);
      if (this.rtp) this.rtp.sendAudio(audio);
    }, 1500);
  }

  private handleBye(request: any) {
    console.log('[SIP] Llamada terminada.');
    this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));
    if (this.rtp) this.rtp.stop();
    if (this.io) this.io.emit('call-ended');
  }

  private getLocalIp() {
    return getLocalIp();
  }
}
