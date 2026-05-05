import axios from 'axios';
import * as dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';

dotenv.config();

export class FishAudioClient {
  private apiKey: string;
  private referenceId: string;

  constructor() {
    this.apiKey = process.env.FISHAUDIO_API_KEY!;
    this.referenceId = process.env.FISHAUDIO_REFERENCE_ID!;
  }

  public async textToSpeech(text: string): Promise<Buffer> {
    console.log(`[FishAudio] Sintetizando voz para: "${text.substring(0, 30)}..."`);
    
    try {
      const response = await axios.post(
        'https://api.fish.audio/v1/tts',
        {
          text,
          reference_id: this.referenceId,
          format: 'mp3',
          latency: 'balanced',
        },
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
