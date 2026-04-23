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
          text: text,
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
            reject(err);
          })
          .on('end', () => {
            resolve(Buffer.concat(pcmChunks));
          })
          .pipe()
          .on('data', (chunk: Buffer) => pcmChunks.push(chunk));
      });
    } catch (error) {
      console.error('[FishAudio] Error en TTS:', error);
      throw error;
    }
  }
}
