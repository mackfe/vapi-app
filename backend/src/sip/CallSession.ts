import { v4 as uuidv4 } from 'uuid';
import { RtpManager } from './RtpManager.js';
import { AiPipeline } from '../ai/Pipeline.js';
import { FishAudioClient } from '../ai/FishAudioClient.js';
import { TicketGenerator } from '../ai/TicketGenerator.js';
import { DbManager } from '../database/DbManager.js';
import { logger } from '../utils/logger.js';

const JITTER_BUFFER_MS = 60;
const SILENCE_TIMEOUT_MS = 1200;
const JITTER_WINDOW_MS = 1000;

export class CallSession {
  public readonly callId: string;
  public readonly callerId: string;
  public readonly startedAt: Date;

  public rtp: RtpManager;
  public ai: AiPipeline;
  public tts: FishAudioClient;
  public io: any;
  public db: DbManager;

  private audioBuffer: Buffer = Buffer.alloc(0);
  private jitterQueue: Array<{ seq: number; ts: number; data: Buffer }> = [];
  private lastPlayedSeq: number = -1;
  private baselineEnergy: number | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private isAiSpeaking: boolean = false;
  private activeSendInterval: NodeJS.Timeout | null = null;
  private hangupTimer: NodeJS.Timeout | null = null;
  private hangupCallback: (() => void) | null = null;

  public metrics = {
    cost: 0, sttCost: 0, llmCost: 0, ttsCost: 0,
    tokens: 0, chars: 0, seconds: 0,
  };

  private static PRICES = {
    STT_PER_MIN: 0.0044,
    LLM_PER_1M_TOKENS: 0.60,
    TTS_PER_1M_CHARS: 5.00,
  };

  constructor(
    callerId: string,
    agent: { groq_api_key: string; ai_model: string; master_prompt: string; voice_reference_id: string; fishaudio_api_key: string; name: string; department?: string },
    knowledgeContext: string,
    rtpPort: number,
    io: any,
    db: DbManager,
  ) {
    this.callId = uuidv4();
    this.callerId = callerId;
    this.startedAt = new Date();
    this.io = io;
    this.db = db;

    this.rtp = new RtpManager(rtpPort);
    this.ai = new AiPipeline(agent.groq_api_key, agent.ai_model, agent.master_prompt, knowledgeContext);
    this.tts = new FishAudioClient(agent.fishaudio_api_key, agent.voice_reference_id);

    logger.info('CallSession creada', { callId: this.callId, callerId, agent: agent.name });
  }

  public async start(): Promise<void> {
    await this.rtp.start();
    this.setupAudioHandling();
  }

  public setHangupCallback(cb: () => void): void {
    this.hangupCallback = cb;
  }

  public playWelcome(agentName: string, department?: string): void {
    const welcome = `Hola, soy ${agentName}${department ? ` de ${department}` : ''}. ¿En qué te puedo ayudar?`;

    setTimeout(async () => {
      if (this.rtp.isStopped()) return;
      if (this.io) this.io.emit('transcription', `IA: ${welcome}`);
      this.isAiSpeaking = true;

      const costTts = (welcome.length / 1_000_000) * CallSession.PRICES.TTS_PER_1M_CHARS;
      this.metrics.ttsCost += costTts;
      this.metrics.chars += welcome.length;
      this.metrics.cost += costTts;

      try {
        const audio = await this.tts.textToSpeech(welcome);
        if (audio.length > 0) {
          this.sendAudioWithSync(audio);
          await this.db.saveTranscript(this.callId, 'ai', welcome);
        } else {
          this.isAiSpeaking = false;
        }
      } catch (err) {
        logger.error('Error en TTS de bienvenida', { callId: this.callId, error: String(err) });
        this.isAiSpeaking = false;
      }
    }, 2000);
  }

  private setupAudioHandling(): void {
    this.rtp.on('audio', (pcm: Buffer) => {
      if (this.isAiSpeaking) return;

      const rtpInfo = (this.rtp as any)._lastRtpInfo;
      if (rtpInfo) {
        this.jitterQueue.push({ seq: rtpInfo.seq, ts: Date.now(), data: pcm });
        this.drainJitterQueue();
      } else {
        this.processAudioChunk(pcm);
      }

      if (this.io) this.io.emit('audio-chunk', pcm);
    });
  }

  private drainJitterQueue(): void {
    this.jitterQueue = this.jitterQueue.filter(p => Date.now() - p.ts < JITTER_WINDOW_MS);
    this.jitterQueue.sort((a, b) => a.seq - b.seq);

    while (this.jitterQueue.length > 0) {
      const pkt = this.jitterQueue[0]!;
      if (this.lastPlayedSeq < 0 || pkt.seq === this.lastPlayedSeq + 1 || pkt.seq === 0) {
        this.jitterQueue.shift();
        this.lastPlayedSeq = pkt.seq;
        this.processAudioChunk(pkt.data);
      } else if (pkt.seq <= this.lastPlayedSeq) {
        this.jitterQueue.shift();
      } else {
        break;
      }
    }
  }

  private processAudioChunk(pcm: Buffer): void {
    const energy = this.calculateEnergy(pcm);

    if (this.baselineEnergy === null) {
      this.baselineEnergy = energy;
    } else if (energy < this.baselineEnergy * 0.8) {
      this.baselineEnergy = this.baselineEnergy * 0.95 + energy * 0.05;
    }

    const adaptiveThreshold = Math.max((this.baselineEnergy ?? 0.001) * 3.0, 0.003);

    if (energy > adaptiveThreshold) {
      this.audioBuffer = Buffer.concat([this.audioBuffer, pcm]);
      if (this.silenceTimer) clearTimeout(this.silenceTimer);

      this.silenceTimer = setTimeout(() => {
        this.processUtterance();
      }, SILENCE_TIMEOUT_MS);
    }
  }

  private async processUtterance(): Promise<void> {
    if (this.audioBuffer.length < 4000) {
      this.audioBuffer = Buffer.alloc(0);
      return;
    }

    const currentBuffer = this.audioBuffer;
    this.audioBuffer = Buffer.alloc(0);

    try {
      const durationSec = currentBuffer.length / 16000;
      const costStt = (durationSec / 60) * CallSession.PRICES.STT_PER_MIN;
      this.metrics.sttCost += costStt;
      this.metrics.seconds += durationSec;
      this.metrics.cost += costStt;

      const text = await this.ai.getTranscription(currentBuffer);
      if (!text || text.trim().length <= 1) return;

      this.isAiSpeaking = true;
      if (this.io) this.io.emit('transcription', `Vecino: ${text}`);

      const aiResult = await this.ai.getAiResponse(text);
      const response = aiResult.text;

      const costLlm = (aiResult.tokens / 1_000_000) * CallSession.PRICES.LLM_PER_1M_TOKENS;
      this.metrics.llmCost += costLlm;
      this.metrics.tokens += aiResult.tokens;
      this.metrics.cost += costLlm;

      if (this.io) this.io.emit('transcription', `IA: ${response}`);

      await this.db.saveTranscript(this.callId, 'user', text);
      await this.db.saveTranscript(this.callId, 'ai', response);

      const costTts = (response.length / 1_000_000) * CallSession.PRICES.TTS_PER_1M_CHARS;
      this.metrics.ttsCost += costTts;
      this.metrics.chars += response.length;
      this.metrics.cost += costTts;

      const audioResponse = await this.tts.textToSpeech(response);
      if (this.io) this.io.emit('audio-chunk', audioResponse);

      if (audioResponse.length > 0) {
        this.sendAudioWithSync(audioResponse);
      } else {
        this.isAiSpeaking = false;
      }

      logger.debug('Costo acumulado', {
        callId: this.callId,
        cost: this.metrics.cost.toFixed(6),
      });
    } catch (err) {
      logger.error('Error en pipeline IA', { callId: this.callId, error: String(err) });
      this.isAiSpeaking = false;
      this.audioBuffer = Buffer.alloc(0);
    }
  }

  private sendAudioWithSync(pcmBuffer: Buffer): void {
    if (this.rtp.isStopped()) return;
    const totalBytes = pcmBuffer.length;
    const durationMs = (totalBytes / 16000) * 1000;
    const bufferMs = durationMs + 600;

    this.rtp.sendAudio(pcmBuffer, (active: boolean) => {
      if (!active) {
        this.isAiSpeaking = false;
        this.activeSendInterval = null;
      }
    });
  }

  private calculateEnergy(pcmChunk: Buffer): number {
    let sum = 0;
    const int16Arr = new Int16Array(pcmChunk.buffer, pcmChunk.byteOffset, pcmChunk.byteLength / 2);
    for (let i = 0; i < int16Arr.length; i++) {
      const sample = int16Arr[i]! / 32768;
      sum += sample * sample;
    }
    return Math.sqrt(sum / int16Arr.length);
  }

  public async hangup(reason: string = 'normal'): Promise<void> {
    logger.info('Finalizando sesión', { callId: this.callId, reason });

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.hangupTimer) {
      clearTimeout(this.hangupTimer);
      this.hangupTimer = null;
    }

    this.isAiSpeaking = false;
    this.audioBuffer = Buffer.alloc(0);

    if (this.activeSendInterval) {
      clearInterval(this.activeSendInterval);
      this.activeSendInterval = null;
    }

    this.rtp.stop();

    await this.db.endCall(this.callId, this.metrics);

    if (this.io) this.io.emit('call-ended', { callId: this.callId });

    if (this.hangupCallback) {
      this.hangupCallback();
    }

    this.generateTicket().catch(err =>
      logger.error('Error generando ticket', { callId: this.callId, error: String(err) })
    );
  }

  private async generateTicket(): Promise<void> {
    try {
      const transcripts = await this.db.getTranscripts(this.callId);
      if (transcripts.length === 0) return;

      const conversation = transcripts
        .map((t: any) => `${t.role === 'user' ? 'Vecino' : 'IA'}: ${t.content}`)
        .join('\n');

      const ticketGen = new TicketGenerator();
      const ticketData = await ticketGen.generateFromTranscript(conversation);
      if (ticketData) {
        await this.db.createTicket(
          this.callId,
          ticketData.subject,
          ticketData.summary,
          ticketData.priority
        );
        logger.info('Ticket generado', { callId: this.callId, subject: ticketData.subject });
      }
    } catch (error) {
      logger.error('Error generando ticket automático', { callId: this.callId, error: String(error) });
    }
  }
}
