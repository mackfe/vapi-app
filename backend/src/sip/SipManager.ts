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
      hostname: '0.0.0.0', // Volvemos a bindeal a todo
    };

    try {
      this.sipStack.start(options, (request: any) => {
        console.log(`[SIP] <--- Petición entrante: ${request.method} desde ${request.headers.from.uri}`);
        this.handleRequest(request);
      });

      console.log('[SIP] Servidor en modo ESCUCHA (Esperando INVITE directo)...');
    } catch (error) {
      console.error('[SIP] Error al iniciar stack:', error);
    }
  }

  private register() {
    const publicIp = process.env.PUBLIC_IP || '200.8.121.19';
    const contact = { uri: `sip:${config.user}@${publicIp}:5060` };
    
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
        expires: 60, // Registro corto para forzar tráfico
      },
    };

    console.log(`[SIP] Reintento de registro con IP Pública y Expiración corta...`);
    this.sipStack.send(request, (response: any) => {
      console.log(`[SIP] Respuesta recibida: ${response.status} ${response.reason}`);
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
    console.log(`[SIP] <--- Petición entrante: ${request.method} desde ${request.headers.from.uri}`);
    if (request.method === 'INVITE') {
      this.handleInvite(request);
    } else if (request.method === 'BYE') {
      this.handleBye(request);
    } else if (request.method === 'OPTIONS') {
      console.log('[SIP] Respondiendo a OPTIONS (Keep-alive)');
      this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));
    }
  }

  private async handleInvite(request: any) {
    console.log('[SIP] ¡Llamada entrante detectada!');
    this.sipStack.send(this.sipStack.makeResponse(request, 180, 'Ringing'));
    
    // Configurar RTP
    this.rtp = new RtpManager();
    await this.rtp.start();

    // Extraer IP y Puerto remoto del SDP del INVITE
    const remoteSdp = request.content || '';
    const ipMatch = remoteSdp.match(/c=IN IP4 ([0-9.]+)/);
    const portMatch = remoteSdp.match(/m=audio ([0-9]+)/);
    
    if (ipMatch && portMatch) {
      this.rtp.setRemote(ipMatch[1], parseInt(portMatch[1], 10));
    } else {
      console.warn('[SIP] No se pudo extraer IP/Puerto del SDP remoto');
    }

    const publicIp = process.env.PUBLIC_IP || '200.8.121.19';
    const sdp = [
      'v=0',
      `o=- ${Date.now()} ${Date.now()} IN IP4 ${publicIp}`,
      's=-',
      `c=IN IP4 ${publicIp}`,
      't=0 0',
      `m=audio ${this.rtp.getPort()} RTP/AVP 0`,
      'a=rtpmap:0 PCMU/8000',
      'a=sendrecv',
    ].join('\r\n') + '\r\n';

    const response = this.sipStack.makeResponse(request, 200, 'OK');
    response.headers.contact = [{ uri: `sip:${config.user}@${publicIp}:5060` }];
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
    let isAiSpeaking = false; // Flag para evitar que la IA se escuche a sí misma

    // Umbral de energía para detección de voz (VAD)
    // 0.01 es un valor sensible pero evita ruido de fondo leve
    const ENERGY_THRESHOLD = 0.02; 

    const calculateEnergy = (pcmChunk: Buffer) => {
      let sum = 0;
      const int16Array = new Int16Array(pcmChunk.buffer, pcmChunk.byteOffset, pcmChunk.byteLength / 2);
      for (let i = 0; i < int16Array.length; i++) {
        const sample = int16Array[i]! / 32768; // Normalizar a [-1, 1]
        sum += sample * sample;
      }
      return Math.sqrt(sum / int16Array.length);
    };

    this.rtp.on('audio', async (data) => {
      // Ignorar entrada si la IA está hablando o el sistema está en silencio
      if (isAiSpeaking) return;

      const energy = calculateEnergy(data);
      
      // Emitir audio al dashboard para monitoreo
      if (this.io) this.io.emit('audio-chunk', data);
      
      // Solo acumular si hay suficiente energía (voz detectada)
      if (energy > ENERGY_THRESHOLD) {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        
        if (silenceTimer) clearTimeout(silenceTimer);
        
        silenceTimer = setTimeout(async () => {
          // Si tenemos al menos 0.5 seg de audio (8000 bytes = 0.5s en 8kHz/16bit)
          if (audioBuffer.length > 4000) {
            const currentBuffer = audioBuffer;
            audioBuffer = Buffer.alloc(0);
            
            console.log(`[VAD] Voz detectada. Procesando ${currentBuffer.length} bytes...`);
            const text = await this.ai.getTranscription(currentBuffer);
            
            if (text && text.trim().length > 1) {
              isAiSpeaking = true; // Bloquear escucha
              console.log(`[AI] Usuario dijo: "${text}"`);
              if (this.io) this.io.emit('transcription', `Vecino: ${text}`);
              
              const response = await this.ai.getAiResponse(text);
              console.log(`[AI] Respuesta: "${response}"`);
              if (this.io) this.io.emit('transcription', `IA: ${response}`);
              
              const audioResponse = await this.tts.textToSpeech(response);
              
              if (this.io) this.io.emit('audio-chunk', audioResponse);
              
              if (this.rtp) {
                this.rtp.sendAudio(audioResponse);
                // Estimar tiempo de reproducción (muy rudo: 8kb por segundo aprox)
                const playDuration = (audioResponse.length / 8000) * 1000 + 500;
                setTimeout(() => {
                  isAiSpeaking = false; // Liberar escucha tras terminar de hablar
                  console.log("[AI] Fin de respuesta. Escuchando de nuevo...");
                }, playDuration);
              }
            }
          } else {
             // Si el audio acumulado era muy corto, probablemente fue ruido, limpiar.
             audioBuffer = Buffer.alloc(0);
          }
        }, 1000); // 1 segundo de silencio para considerar fin de frase
      }
    });

    // Mensaje de bienvenida inicial
    setTimeout(async () => {
      const welcome = "Hola, bienvenido a la línea de atención del Municipio de 3 de Febrero. ¿En qué puedo ayudarte con el tema de podas o árboles?";
      if (this.io) this.io.emit('transcription', `IA: ${welcome}`);
      isAiSpeaking = true;
      const audio = await this.tts.textToSpeech(welcome);
      if (this.rtp) {
        this.rtp.sendAudio(audio);
        const playDuration = (audio.length / 8000) * 1000 + 500;
        setTimeout(() => { isAiSpeaking = false; }, playDuration);
      }
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
