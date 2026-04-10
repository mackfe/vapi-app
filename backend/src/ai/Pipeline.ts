import { DeepgramClient } from '@deepgram/sdk';
import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
import { MUNICIPAL_KNOWLEDGE } from './knowledge.js';

dotenv.config();

export class AiPipeline {
  private deepgram: DeepgramClient;
  private groq: Groq;

  constructor() {
    this.deepgram = new DeepgramClient();
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  public async getTranscription(audioBuffer: Buffer) {
    try {
      const { result, error } = await (this.deepgram.listen as any).prerecorded.transcribeFile(
        audioBuffer,
        {
          model: 'nova-2',
          smart_format: true,
          language: 'es-419',
        }
      );

      if (error) throw error;
      return result.results.channels[0].alternatives[0].transcript;
    } catch (err) {
      console.error('[Deepgram] Error de transcripción:', err);
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
