import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export class FishAudioClient {
  private apiKey: string;
  private referenceId: string;

  constructor() {
    this.apiKey = process.env.FISHAUDIO_API_KEY!;
    this.referenceId = process.env.FISHAUDIO_REFERENCE_ID!;
  }

  public async textToSpeech(text: string) {
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

      return Buffer.from(response.data);
    } catch (error) {
      console.error('[FishAudio] Error en TTS:', error);
      throw error;
    }
  }
}
