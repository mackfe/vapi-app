import sip from 'sip';
import { createAuthHeader } from './SipUtils.js';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { RtpManager } from './RtpManager.js';
import { getLocalIp } from '../utils/network.js';
import { AiPipeline } from '../ai/Pipeline.js';
import { FishAudioClient } from '../ai/FishAudioClient.js';
import { TicketGenerator } from '../ai/TicketGenerator.js';
import { DbManager } from '../database/DbManager.js';

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
  private ticketGen: TicketGenerator;
  private db: DbManager;
  private io: any;

  constructor(io?: any) {
    this.sipStack = sip;
    this.ai = new AiPipeline();
    this.tts = new FishAudioClient();
    this.ticketGen = new TicketGenerator();
    this.db = new DbManager();
    this.db.init();
    this.io = io;
  }

  public getDb() {
    return this.db;
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
    
    // Limpiar puerto de la llamada anterior si quedó abierto
    if (this.rtp) {
      console.log('[RTP] Limpiando puerto de la llamada anterior...');
      this.rtp.stop();
    }

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

    let publicIp = process.env.PUBLIC_IP || '212.56.33.91';
    if (JSON.stringify(request).includes('192.168.')) {
      console.log('[SIP] Detectada red local. Usando IP interna 192.168.1.114 para el audio.');
      publicIp = '192.168.1.114';
    }

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

    console.log(`\n================ SDP ENVIADO A DAINUS ================`);
    console.log(sdp);
    console.log(`======================================================\n`);

    const response = this.sipStack.makeResponse(request, 200, 'OK');
    response.headers.contact = [{ uri: `sip:${config.user}@${publicIp}:5060` }];
    response.headers['content-type'] = 'application/sdp';
    response.content = sdp;

    this.sipStack.send(response);
    
    // Extraer Caller ID del encabezado From
    const callerUri = request.headers.from.uri;
    const callerId = callerUri.split(':')[1]?.split('@')[0] || 'Desconocido';

    // FILTRO DE SEGURIDAD: Ignorar números de prueba, escaneos o bots
    const isSuspicious = callerId.length < 7 || /^(.)\1+$/.test(callerId) || callerId === 'admin' || callerId === 'asterisk';
    
    if (isSuspicious) {
      console.log(`[SIP] ⚠️ Llamada filtrada (Prueba/Bot): ${callerId}. No se registrará.`);
      this.sipStack.send(this.sipStack.makeResponse(request, 480, 'Temporarily Unavailable'));
      if (this.rtp) this.rtp.stop();
      return;
    }
    
    this.callId = uuidv4();
    console.log(`[SIP] Llamada aceptada de: ${callerId}. Intentando registrar en DB... (ID: ${this.callId})`);
    if (this.io) this.io.emit('call-started', { callerId });
    
    // Registrar llamada en DB
    await this.db.createCall(this.callId, callerId);

    // Estado para manejo de voz y costos
    let audioBuffer = Buffer.alloc(0);
    let silenceTimer: NodeJS.Timeout | null = null;
    let isAiSpeaking = false;
    let totalCallCost = 0;

    // Precios de referencia
    const PRICES = {
      STT_PER_MIN: 0.0044, // Deepgram
      LLM_PER_1M_TOKENS: 0.60, // Groq
      TTS_PER_1M_CHARS: 5.00 // FishAudio
    };

    const calculateEnergy = (pcmChunk: Buffer) => {
      let sum = 0;
      const int16Array = new Int16Array(pcmChunk.buffer, pcmChunk.byteOffset, pcmChunk.byteLength / 2);
      for (let i = 0; i < int16Array.length; i++) {
        const sample = int16Array[i]! / 32768;
        sum += sample * sample;
      }
      return Math.sqrt(sum / int16Array.length);
    };

    this.rtp.on('audio', async (data) => {
      if (isAiSpeaking) return;
      const energy = calculateEnergy(data);
      if (this.io) this.io.emit('audio-chunk', data);
      
      if (energy > 0.005) {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        if (silenceTimer) clearTimeout(silenceTimer);
        
        silenceTimer = setTimeout(async () => {
          if (audioBuffer.length > 4000) {
            const currentBuffer = audioBuffer;
            audioBuffer = Buffer.alloc(0);
            
            // 1. Costo STT (Deepgram)
            const durationSec = currentBuffer.length / 16000;
            const costStt = (durationSec / 60) * PRICES.STT_PER_MIN;
            totalCallCost += costStt;

            const text = await this.ai.getTranscription(currentBuffer);
            if (text && text.trim().length > 1) {
              isAiSpeaking = true;
              if (this.io) this.io.emit('transcription', `Vecino: ${text}`);
              
              const response = await this.ai.getAiResponse(text);
              
              // 2. Costo LLM (Groq) - Estimación tokens: palabras * 1.3
              const tokens = response.split(' ').length * 1.3;
              const costLlm = (tokens / 1000000) * PRICES.LLM_PER_1M_TOKENS;
              totalCallCost += costLlm;

              if (this.io) this.io.emit('transcription', `IA: ${response}`);
              
              await this.db.saveTranscript(this.callId, 'user', text);
              await this.db.saveTranscript(this.callId, 'ai', response);
              
              // 3. Costo TTS (FishAudio)
              const costTts = (response.length / 1000000) * PRICES.TTS_PER_1M_CHARS;
              totalCallCost += costTts;

              const audioResponse = await this.tts.textToSpeech(response);
              if (this.io) this.io.emit('audio-chunk', audioResponse);
              
              if (this.rtp && audioResponse.length > 0) {
                this.rtp.sendAudio(audioResponse);
                const playDuration = (audioResponse.length / 16000) * 1000 + 500;
                setTimeout(() => { isAiSpeaking = false; }, playDuration);
              } else {
                isAiSpeaking = false;
              }
              
              console.log(`[COST] Costo acumulado de la llamada: $${totalCallCost.toFixed(6)}`);
            }
          } else {
             audioBuffer = Buffer.alloc(0);
          }
        }, 1000);
      }
    });

    // Bienvenida
    setTimeout(async () => {
      const welcome = "Hola, bienvenido a la línea de atención del Municipio de 3 de Febrero. ¿En qué puedo ayudarte?";
      if (this.io) this.io.emit('transcription', `IA: ${welcome}`);
      isAiSpeaking = true;
      
      // Costo Bienvenida (Solo TTS)
      totalCallCost += (welcome.length / 1000000) * PRICES.TTS_PER_1M_CHARS;

      const audio = await this.tts.textToSpeech(welcome);
      if (this.rtp && audio.length > 0) {
        this.rtp.sendAudio(audio);
        await this.db.saveTranscript(this.callId, 'ai', welcome);
        setTimeout(() => { isAiSpeaking = false; }, (audio.length / 16000) * 1000 + 500);
      } else {
        isAiSpeaking = false;
      }
    }, 1500);

    // Guardamos la referencia de costo en la instancia para usarla en handleBye
    (this as any).currentCallCost = () => totalCallCost;
  }

  private async handleBye(request: any) {
    console.log('[SIP] Llamada terminada.');
    this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));
    
    // Recuperar costo acumulado
    const finalCost = (this as any).currentCallCost ? (this as any).currentCallCost() : 0;

    // Registrar fin de llamada con costo
    await this.db.endCall(this.callId, finalCost);
    
    // [NUEVO] Generar Ticket AI Automáticamente
    this.generateCallTicket(this.callId).catch(err => console.error('[Ticket] Fail:', err));

    // Limpiar estado
    this.rtpServer?.close();
    if (this.rtp) this.rtp.stop();
    if (this.io) this.io.emit('call-ended');
  }

  private async generateCallTicket(callId: string) {
    try {
      const transcripts = await this.db.getTranscripts(callId);
      if (transcripts.length === 0) return;

      const conversation = transcripts
        .map((t: any) => `${t.role === 'user' ? 'Vecino' : 'IA'}: ${t.content}`)
        .join('\n');

      const ticketData = await this.ticketGen.generateFromTranscript(conversation);
      if (ticketData) {
        await this.db.createTicket(
          callId, 
          ticketData.subject, 
          ticketData.summary, 
          ticketData.priority
        );
      }
    } catch (error) {
      console.error('[SIP] Error al generar ticket automático:', error);
    }
  }

  private getLocalIp() {
    return getLocalIp();
  }
}
