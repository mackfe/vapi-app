import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';

dotenv.config();

export interface TicketData {
  subject: string;
  summary: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export class TicketGenerator {
  private groq: Groq;

  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  public async generateFromTranscript(transcript: string): Promise<TicketData | null> {
    if (!transcript || transcript.length < 10) return null;

    try {
      console.log(`[TicketGen] Generando reporte para transcripción de ${transcript.length} caracteres...`);
      
      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `Eres un analista de atención al vecino. Tu tarea es leer una transcripción de llamada y generar un reporte de ticket estructurado en formato JSON.
            
            Debes devolver ÚNICAMENTE un objeto JSON con esta estructura:
            {
              "subject": "Título breve y descriptivo (máximo 60 caracteres)",
              "summary": "Un resumen ejecutivo de lo que pidió el vecino y lo que respondió la IA",
              "priority": "Una de estas: low, medium, high, urgent"
            }
            
            Criterios de prioridad:
            - urgent: Peligro inminente, cables caídos, árboles a punto de caer sobre casas.
            - high: Obstrucción de vía pública, ramas grandes caídas.
            - medium: Pedidos de poda, reclamos de mantenimiento.
            - low: Consultas generales, información de horarios.`
          },
          {
            role: 'user',
            content: `Transcripción de la llamada:\n\n${transcript}`
          }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: "json_object" }
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) return null;

      return JSON.parse(content) as TicketData;
    } catch (error) {
      console.error('[TicketGen] Error generating ticket:', error);
      return null;
    }
  }
}
