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
  private ticketGen: TicketGenerator;
  private db: DbManager;
  private io: any;

  // Estado de Llamada (VAD)
  private audioBuffer: Buffer = Buffer.alloc(0);
  private silenceTimer: NodeJS.Timeout | null = null;
  private isAiSpeaking: boolean = false;

  constructor(io?: any) {
    this.sipStack = sip;
    this.ticketGen = new TicketGenerator();
    this.db = new DbManager();
    this.db.init();
    this.io = io;
  }

  public getDb() {
    return this.db;
  }

  public async start() {
    console.log(`[SIP] Iniciando stack SIP...`);
    
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
      
      // Realizar registro de todos los agentes que tengan credenciales
      const publicIp = process.env.PUBLIC_IP || '200.8.121.19';
      const agents = await this.db.getAgents();
      for (const agent of agents) {
        if (agent.sip_domain && agent.sip_user && agent.sip_password) {
          console.log(`[SIP] Registrando Agente: ${agent.name} en ${agent.sip_domain}`);
          this.register(agent.sip_domain, agent.sip_user, agent.sip_password, publicIp);
        }
      }
    } catch (error) {
      console.error('[SIP] Error al iniciar stack:', error);
    }
  }

  private register(domain: string, user: string, pass: string, publicIp: string) {
    const contact = { uri: `sip:${user}@${publicIp}:5060` };
    
    const request = {
      method: 'REGISTER',
      uri: `sip:${domain}`,
      headers: {
        to: { uri: `sip:${user}@${domain}` },
        from: { uri: `sip:${user}@${domain}`, params: { tag: uuidv4() } },
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
          const authHeader = createAuthHeader('REGISTER', request.uri, authHeaderStr, user, pass);
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
    } else if (request.method === 'CANCEL') {
      console.log('[SIP] Llamada cancelada por el llamante.');
      this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));
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
    let ipMatch = remoteSdp.match(/c=IN IP4 ([0-9.]+)/);
    const portMatch = remoteSdp.match(/m=audio ([0-9]+)/);
    
    if (ipMatch && ipMatch[1] === '0.0.0.0') {
      console.warn('[SIP] Advertencia: SDP remoto con IP 0.0.0.0. Infiriendo desde Via...');
      if (request.headers?.via?.[0]?.host) {
        ipMatch = [ipMatch[0], request.headers.via[0].host];
      }
    }
    
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

    
    // Extraer Caller ID del encabezado From
    const callerUri = request.headers.from.uri;
    const callerId = callerUri.split(':')[1]?.split('@')[0] || 'Desconocido';

    // [NUEVO] Escudo de Seguridad
    const securityMode = await this.db.getSecurityMode();
    let isBlocked = false;

    if (securityMode === 'whitelist') {
      const isAllowed = await this.db.isAllowedInWhitelist(callerId);
      if (!isAllowed) {
        console.log(`[SIP] 🛡️ Llamada BLOQUEADA por Whitelist (Modo Estricto): ${callerId}`);
        isBlocked = true;
      }
    } else {
      isBlocked = await this.db.isBlacklisted(callerId);
      if (isBlocked) {
        console.log(`[SIP] 🛡️ Llamada BLOQUEADA por Blacklist: ${callerId}`);
      }
    }

    if (isBlocked) {
      this.sipStack.send(this.sipStack.makeResponse(request, 403, 'Forbidden'));
      if (this.rtp) this.rtp.stop();
      return; // Cortar la ejecución aquí, no gasta tokens ni DB
    }

    // FILTRO DE SEGURIDAD: Ignorar números de prueba, escaneos o bots
    const toUri = request.headers.to.uri || '';
    const destinationNumber = toUri.split(':')[1]?.split('@')[0];

    // [NUEVO] Búsqueda Dinámica de Agente
    const agent = await this.db.getAgentByPhone(destinationNumber);
    if (!agent) {
      console.log(`[SIP] ⚠️ Llamada a extensión no configurada (${destinationNumber}). Rechazada.`);
      this.sipStack.send(this.sipStack.makeResponse(request, 404, 'Not Found'));
      if (this.rtp) this.rtp.stop();
      return;
    }

    // TODO CORRECTO: Ahora sí contestamos la llamada
    this.sipStack.send(response);

    const docs = await this.db.getAgentDocuments(agent.id);
    const knowledgeContext = docs.map(d => d.extracted_content).join('\n\n');

    // [NUEVO] Instanciación Aislada de IA con Contexto Dinámico
    const callAi = new AiPipeline(agent.groq_api_key, agent.ai_model, agent.master_prompt, knowledgeContext);
    const callTts = new FishAudioClient(agent.fishaudio_api_key, agent.voice_reference_id);

    this.callId = uuidv4();
    console.log(`[SIP] Llamada aceptada de: ${callerId} hacia el Agente: ${agent.name} (${destinationNumber}). (ID: ${this.callId})`);
    if (this.io) this.io.emit('call-started', { callerId, agentName: agent.name });
    
    // Registrar llamada en DB
    await this.db.createCall(this.callId, callerId);

    // Estado para manejo de voz y costos
    this.audioBuffer = Buffer.alloc(0);
    this.isAiSpeaking = false;
    let metrics = { cost: 0, sttCost: 0, llmCost: 0, ttsCost: 0, tokens: 0, chars: 0, seconds: 0 };

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
      if (this.isAiSpeaking) return;
      const energy = calculateEnergy(data);
      if (this.io) this.io.emit('audio-chunk', data);
      
      if (energy > 0.005) {
        this.audioBuffer = Buffer.concat([this.audioBuffer, data]);
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        
        this.silenceTimer = setTimeout(async () => {
          if (this.audioBuffer.length > 4000) {
            const currentBuffer = this.audioBuffer;
            this.audioBuffer = Buffer.alloc(0);
            
            try {
              // 1. Costo STT (Deepgram)
              const durationSec = currentBuffer.length / 16000;
              const costStt = (durationSec / 60) * PRICES.STT_PER_MIN;
              metrics.sttCost += costStt;
              metrics.seconds += durationSec;
              metrics.cost += costStt;

              const text = await callAi.getTranscription(currentBuffer);
              if (text && text.trim().length > 1) {
                this.isAiSpeaking = true;
                if (this.io) this.io.emit('transcription', `Vecino: ${text}`);
                
                const aiResult = await callAi.getAiResponse(text);
                const response = aiResult.text;
                
                // 2. Costo LLM (Groq)
                const tokens = aiResult.tokens;
                const costLlm = (tokens / 1000000) * PRICES.LLM_PER_1M_TOKENS;
                metrics.llmCost += costLlm;
                metrics.tokens += tokens;
                metrics.cost += costLlm;

                if (this.io) this.io.emit('transcription', `IA: ${response}`);
                
                await this.db.saveTranscript(this.callId, 'user', text);
                await this.db.saveTranscript(this.callId, 'ai', response);
                
                // 3. Costo TTS (FishAudio)
                const costTts = (response.length / 1000000) * PRICES.TTS_PER_1M_CHARS;
                metrics.ttsCost += costTts;
                metrics.chars += response.length;
                metrics.cost += costTts;

                const audioResponse = await callTts.textToSpeech(response);
                if (this.io) this.io.emit('audio-chunk', audioResponse);
                
                if (this.rtp && audioResponse.length > 0) {
                  this.rtp.sendAudio(audioResponse);
                  const playDuration = (audioResponse.length / 16000) * 1000 + 500;
                  setTimeout(() => { this.isAiSpeaking = false; }, playDuration);
                } else {
                  this.isAiSpeaking = false;
                }
                
                console.log(`[COST] Costo acumulado de la llamada: $${metrics.cost.toFixed(6)}`);
              } else {
                this.isAiSpeaking = false;
              }
            } catch (err) {
              console.error('[SIP] Error en el pipeline de IA (STT/LLM/TTS):', err);
              this.isAiSpeaking = false;
              this.audioBuffer = Buffer.alloc(0);
            }
          } else {
             this.audioBuffer = Buffer.alloc(0);
          }
        }, 2500);
      }
    });

    // Bienvenida
    setTimeout(async () => {
      const welcome = `Hola, soy ${agent.name}${agent.department ? ` de ${agent.department}` : ''}. ¿En qué te puedo ayudar?`;
      if (this.io) this.io.emit('transcription', `IA: ${welcome}`);
      this.isAiSpeaking = true;
      
      // Costo Bienvenida (Solo TTS)
      const costTts = (welcome.length / 1000000) * PRICES.TTS_PER_1M_CHARS;
      metrics.ttsCost += costTts;
      metrics.chars += welcome.length;
      metrics.cost += costTts;

      try {
        const audio = await callTts.textToSpeech(welcome);
        if (this.rtp && audio.length > 0) {
          this.rtp.sendAudio(audio);
          await this.db.saveTranscript(this.callId, 'ai', welcome);
          setTimeout(() => { this.isAiSpeaking = false; }, (audio.length / 16000) * 1000 + 500);
        } else {
          this.isAiSpeaking = false;
        }
      } catch (err) {
        console.error('[SIP] Error en TTS de Bienvenida:', err);
        this.isAiSpeaking = false;
      }
    }, 3000);

    // Guardamos la referencia de costo en la instancia para usarla en handleBye
    (this as any).currentCallMetrics = () => metrics;
  }

  private async handleBye(request: any) {
    console.log('[SIP] Llamada terminada.');
    this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));
    
    // Recuperar costo acumulado
    const finalMetrics = (this as any).currentCallMetrics ? (this as any).currentCallMetrics() : { cost: 0, sttCost: 0, llmCost: 0, ttsCost: 0, tokens: 0, chars: 0, seconds: 0 };

    // Registrar fin de llamada con costo
    await this.db.endCall(this.callId, finalMetrics);
    
    // [NUEVO] Generar Ticket AI Automáticamente
    this.generateCallTicket(this.callId).catch(err => console.error('[Ticket] Fail:', err));

    // Limpiar estado y fugas de memoria
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.isAiSpeaking = false;
    this.audioBuffer = Buffer.alloc(0);

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
