import axios from 'axios';
import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
import { MUNICIPAL_KNOWLEDGE } from './knowledge.js';

dotenv.config();

export class AiPipeline {
  private groq: Groq;

  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  private createWavHeader(dataLength: number): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    header.writeUInt16LE(1, 22); // NumChannels (1)
    header.writeUInt32LE(8000, 24); // SampleRate (8000)
    header.writeUInt32LE(8000 * 1 * 2, 28); // ByteRate
    header.writeUInt16LE(1 * 2, 32); // BlockAlign
    header.writeUInt16LE(16, 34); // BitsPerSample (16)
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }

  public async getTranscription(audioBuffer: Buffer) {
    try {
      const wavHeader = this.createWavHeader(audioBuffer.length);
      const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);

      const response = await axios.post(
        'https://api.deepgram.com/v1/listen?model=nova-2&language=es-419&smart_format=true',
        wavBuffer,
        {
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'audio/wav'
          }
        }
      );

      return response.data?.results?.channels[0]?.alternatives[0]?.transcript || "";
    } catch (err: any) {
      console.error('[Deepgram] Error de transcripción:', err.response?.data || err.message);
      return "";
    }
  }

  public async getAiResponse(text: string) {
    console.log(`[Groq] Pensando respuesta para: "${text}"...`);
    const chatCompletion = await this.groq.chat.completions.create({
      messages: [
        { 
          role: 'system', 
          content: `Eres un asistente de voz amable y profesional del Municipio de 3 de Febrero.
          Tu objetivo es ayudar a los vecinos con temas de árboles, poda y restos verdes.
          
          REGLAS DE ORO:
          1. Usa lenguaje claro, breve y oral. Frases cortas. Una idea por oración.
          2. Pide un solo dato por vez.
          3. No prometas aprobaciones ni resoluciones.
          4. Si la información no está en la base de datos, indica que no está especificado.
          
          BASE DE CONOCIMIENTO:
          ${MUNICIPAL_KNOWLEDGE}`
        },
        { role: 'user', content: text },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      stream: false,
    });

    return chatCompletion.choices[0]?.message?.content || "Lo siento, no pude procesar eso.";
  }
}
