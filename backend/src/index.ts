import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import * as dotenv from 'dotenv';
import { SipManager } from './sip/SipManager.js';
import { AiPipeline } from './ai/Pipeline.js';
import { FishAudioClient } from './ai/FishAudioClient.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const port = process.env.PORT || 5000;

// Inicializar servicios
const ai = new AiPipeline();
const tts = new FishAudioClient();
const sip = new SipManager(io);

io.on('connection', (socket) => {
  console.log('[Dashboard] Cliente conectado');
});

// Endpoint de prueba para verificar FishAudio y Groq
app.get('/test-ai', async (req: any, res: any) => {
  try {
    const text = "Hola, soy el asistente de inteligencia artificial. ¿Cómo puedo ayudarte hoy?";
    const response = await ai.getAiResponse("Dime una breve bienvenida");
    const audioBuffer = await tts.textToSpeech(response);
    
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error) {
    res.status(500).send(error);
  }
});

server.listen(port, () => {
  console.log(`[Server] Corriendo en http://localhost:${port}`);
  
  // Iniciar stack SIP
  sip.start().catch((err: any) => {
    console.error('[SIP] Error crítico al iniciar:', err);
  });
});
