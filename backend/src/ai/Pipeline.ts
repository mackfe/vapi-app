import axios from 'axios';
import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

export class AiPipeline {
  private groq: Groq;
  private model: string;
  private masterPrompt: string;
  private knowledgeContext: string;
  private messages: any[] = [];
  private modelConfig: { temperature: number; maxTokens: number | null };

  constructor(apiKey?: string, model?: string, masterPrompt?: string, knowledgeContext?: string) {
    this.groq = new Groq({ apiKey: apiKey || process.env.GROQ_API_KEY });
    this.model = model || 'llama-3.3-70b-versatile';
    this.masterPrompt = masterPrompt || 'Eres un asistente de voz amable y profesional. Responde en español con frases cortas y claras.';
    this.knowledgeContext = knowledgeContext || '';

    this.modelConfig = {
      temperature: 0.7,
      maxTokens: null,
    };

    const modelLower = this.model.toLowerCase();
    if (modelLower.includes('deepseek') || modelLower.includes('r1')) {
      this.modelConfig = {
        temperature: 0.6,
        maxTokens: 800,
      };
    }

    this.messages = [
      {
        role: 'system',
        content: `${this.masterPrompt}

        REGLAS DE ORO:
        1. Usa lenguaje claro, breve y oral. Frases cortas. Una idea por oración.
        2. Pide un solo dato por vez.
        3. No prometas aprobaciones ni resoluciones.
        4. Si la información no está en la base de datos, indica que no está especificado.
        5. Responde en español siempre.
        6. Máximo 3 oraciones por respuesta.

        BASE DE CONOCIMIENTO (Contexto):
        ${this.knowledgeContext}`,
      },
    ];
  }

  private createWavHeader(dataLength: number): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(8000 * 1 * 2, 28);
    header.writeUInt16LE(1 * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }

  public async getTranscription(audioBuffer: Buffer): Promise<string> {
    try {
      const wavHeader = this.createWavHeader(audioBuffer.length);
      const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);

      const deepgramKey = process.env.DEEPGRAM_API_KEY;
      if (!deepgramKey) {
        logger.error('DEEPGRAM_API_KEY no configurada');
        return '';
      }

      const response = await axios.post(
        'https://api.deepgram.com/v1/listen?model=nova-2&language=es-419&smart_format=true&utterance_end_ms=1000&interim_results=false',
        wavBuffer,
        {
          headers: {
            'Authorization': `Token ${deepgramKey}`,
            'Content-Type': 'audio/wav',
          },
          timeout: 8000,
        }
      );

      return response.data?.results?.channels[0]?.alternatives[0]?.transcript || '';
    } catch (err: any) {
      const errorMsg = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : err.message;
      logger.error('Error de transcripción Deepgram', { error: errorMsg });
      return '';
    }
  }

  public async getAiResponse(text: string): Promise<{ text: string; tokens: number }> {
    logger.debug('Groq pensando respuesta', { text: text.substring(0, 50) });

    this.messages.push({ role: 'user', content: text });

    if (this.messages.length > 15) {
      this.messages.splice(1, 2);
    }

    try {
      const chatCompletion = await this.groq.chat.completions.create({
        messages: this.messages,
        model: this.model,
        temperature: this.modelConfig.temperature,
        max_tokens: this.modelConfig.maxTokens,
        stream: false,
      });

      const aiResponse = chatCompletion.choices[0]?.message?.content || 'Lo siento, no pude procesar eso.';
      this.messages.push({ role: 'assistant', content: aiResponse });

      return {
        text: aiResponse,
        tokens: chatCompletion.usage?.total_tokens || 0,
      };
    } catch (err: any) {
      logger.error('Error en Groq LLM', { error: err.message });
      return {
        text: 'Lo siento, tuve un problema procesando tu consulta. ¿Podrías intentarlo de nuevo?',
        tokens: 0,
      };
    }
  }
}
