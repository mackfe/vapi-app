import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { SipManager } from './sip/SipManager.js';
import { AiPipeline } from './ai/Pipeline.js';
import { FishAudioClient } from './ai/FishAudioClient.js';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const port = process.env.PORT || 5000;

// Inicializar servicios
const ai = new AiPipeline();
const tts = new FishAudioClient();
const sip = new SipManager(io);

// Rutas de API para el Historial
app.get('/api/calls', async (req, res) => {
  try {
    const calls = await sip.getDb().getCalls();
    res.json(calls);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener llamadas' });
  }
});

app.get('/api/calls/:id/transcripts', async (req, res) => {
  try {
    const transcripts = await sip.getDb().getTranscripts(req.params.id);
    res.json(transcripts);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener transcripciones' });
  }
});

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
