import axios from 'axios';
import * as dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';
import { logger } from '../utils/logger.js';

dotenv.config();

const ttsCache = new Map<string, Buffer>();
const CACHE_MAX_SIZE = 50;
const COMMON_PHRASES = [
  'Hola, soy el asistente',
  '¿En qué te puedo ayudar?',
  'No entendí, ¿podrías repetir?',
  'Gracias por tu llamada',
  'Un momento por favor',
  'Lo siento, no pude procesar eso',
  '¿Hay algo más en lo que pueda ayudarte?',
];

export class FishAudioClient {
  private apiKey: string;
  private referenceId: string;

  constructor(apiKey?: string, referenceId?: string) {
    this.apiKey = apiKey !== undefined ? apiKey : process.env.FISHAUDIO_API_KEY!;
    this.referenceId = referenceId !== undefined ? referenceId : process.env.FISHAUDIO_REFERENCE_ID!;
  }

  private cacheKey(text: string): string {
    return text.substring(0, 80).toLowerCase().trim();
  }

  private isCacheable(text: string): boolean {
    return COMMON_PHRASES.some((phrase) =>
      text.toLowerCase().includes(phrase.toLowerCase())
    );
  }

  public async textToSpeech(text: string): Promise<Buffer> {
    const key = this.cacheKey(text);

    if (this.isCacheable(text)) {
      const cached = ttsCache.get(key);
      if (cached) {
        logger.debug('TTS cache hit', { text: text.substring(0, 30) });
        return cached;
      }
    }

    logger.info('Sintetizando voz', { text: text.substring(0, 30) });

    try {
      const payload: any = {
        text,
        format: 'mp3',
        latency: 'balanced',
      };
      if (this.referenceId && this.referenceId.trim() !== '' && this.referenceId !== 'custom') {
        payload.reference_id = this.referenceId;
      }

      const response = await axios.post(
        'https://api.fish.audio/v1/tts',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 15000,
        }
      );

      const mp3Buffer = Buffer.from(response.data);
      const pcmBuffer = await this.convertMp3ToPcm(mp3Buffer);

      if (pcmBuffer.length > 0 && this.isCacheable(text)) {
        if (ttsCache.size >= CACHE_MAX_SIZE) {
          const firstKey = ttsCache.keys().next().value;
          if (firstKey) ttsCache.delete(firstKey);
        }
        ttsCache.set(key, pcmBuffer);
      }

      return pcmBuffer;
    } catch (error: any) {
      const errorMsg = error.response?.data?.toString()?.substring(0, 100) || error.message;
      logger.error('Error en FishAudio TTS', { error: errorMsg });
      return Buffer.alloc(0);
    }
  }

  public async generateDemoMp3(text: string): Promise<Buffer> {
    logger.info('Generando Demo MP3', { text: text.substring(0, 30) });

    try {
      const payload: any = {
        text,
        format: 'mp3',
        latency: 'balanced',
      };
      if (this.referenceId && this.referenceId.trim() !== '' && this.referenceId !== 'custom') {
        payload.reference_id = this.referenceId;
      }

      const response = await axios.post(
        'https://api.fish.audio/v1/tts',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 15000,
        }
      );

      return Buffer.from(response.data);
    } catch (error: any) {
      const errorMsg = error.response?.data?.toString()?.substring(0, 100) || error.message;
      logger.error('Error generando demo FishAudio', { error: errorMsg });
      throw new Error('Failed to generate demo from FishAudio');
    }
  }

  private convertMp3ToPcm(mp3Buffer: Buffer): Promise<Buffer> {
    return new Promise((resolve) => {
      const pcmChunks: Buffer[] = [];
      const inputStream = new Readable();
      inputStream.push(mp3Buffer);
      inputStream.push(null);

      ffmpeg(inputStream)
        .inputFormat('mp3')
        .audioCodec('pcm_s16le')
        .audioFrequency(8000)
        .audioChannels(1)
        .format('s16le')
        .on('error', (err: Error) => {
          logger.error('FFmpeg error transcodificando', { error: err.message });
          resolve(Buffer.alloc(0));
        })
        .on('end', () => {
          resolve(Buffer.concat(pcmChunks));
        })
        .pipe()
        .on('data', (chunk: Buffer) => {
          pcmChunks.push(chunk);
        });
    });
  }
}
