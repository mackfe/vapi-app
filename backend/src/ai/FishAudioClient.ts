import axios from 'axios';
import * as dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';

dotenv.config();

export class FishAudioClient {
  private apiKey: string;
  private referenceId: string;

  constructor(apiKey?: string, referenceId?: string) {
    this.apiKey = apiKey !== undefined ? apiKey : process.env.FISHAUDIO_API_KEY!;
    this.referenceId = referenceId !== undefined ? referenceId : process.env.FISHAUDIO_REFERENCE_ID!;
  }

  public async textToSpeech(text: string): Promise<Buffer> {
    console.log(`[FishAudio] Sintetizando voz para: "${text.substring(0, 30)}..."`);
    
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
        }
      );

      const mp3Buffer = Buffer.from(response.data);
      return await this.convertMp3ToPcm(mp3Buffer);
    } catch (error: any) {
      console.error('[FishAudio] ERROR CRÍTICO:', error.response?.data?.toString() || error.message);
      // Retornar buffer vacío en lugar de lanzar error para no tumbar el servidor
      return Buffer.alloc(0);
    }
  }

  public async generateDemoMp3(text: string): Promise<Buffer> {
    console.log(`[FishAudio] Generando Demo MP3 para: "${text.substring(0, 30)}..."`);
    
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
        }
      );

      return Buffer.from(response.data);
    } catch (error: any) {
      console.error('[FishAudio] ERROR GENERANDO DEMO:', error.response?.data?.toString() || error.message);
      throw new Error("Failed to generate demo from FishAudio");
    }
  }

  private convertMp3ToPcm(mp3Buffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
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
        .on('error', (err) => {
          console.error('[FFmpeg] Error transcodificando audio:', err);
          resolve(Buffer.alloc(0)); // Retornar vacío en error
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
