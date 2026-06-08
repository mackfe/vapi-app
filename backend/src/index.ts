import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import jwt from 'jsonwebtoken';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { SipManager } from './sip/SipManager.js';
import { AiPipeline } from './ai/Pipeline.js';
import { FishAudioClient } from './ai/FishAudioClient.js';
import { TicketGenerator } from './ai/TicketGenerator.js';
import multer from 'multer';
import mammoth from 'mammoth';
import Groq from 'groq-sdk';
import * as pdfModule from 'pdf-parse-new';
import crypto from 'crypto';
import { logger } from './utils/logger.js';

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxRequests: number = 30) {
  return (req: any, res: any, next: any) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = ip;
    const now = Date.now();
    const entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }

    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intente más tarde.' });
    }

    entry.count++;
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 60_000);

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    if (
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Formato no soportado. Sólo PDF o DOCX.'));
    }
  },
});

const LOGIN_EMAIL = process.env.LOGIN_EMAIL || 'admin@admin';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'vox.ia1234';

app.post('/api/login', rateLimit(5), (req: any, res: any) => {
  const { email, password } = req.body;
  if (email === LOGIN_EMAIL && password === LOGIN_PASSWORD) {
    const token = jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

const verifyToken = (req: any, res: any, next: any) => {
  if (
    req.path === '/login' ||
    req.originalUrl === '/api/login' ||
    req.path === '/health' ||
    req.path === '/api/health'
  )
    return next();

  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'Token requerido' });

  jwt.verify(token.replace('Bearer ', ''), JWT_SECRET, (err: any) => {
    if (err) return res.status(401).json({ error: 'Token inválido' });
    next();
  });
};

app.use('/api', verifyToken);
app.use('/api', rateLimit(60));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Token requerido'));
  }
  try {
    jwt.verify(token as string, JWT_SECRET);
    next();
  } catch {
    next(new Error('Token inválido'));
  }
});

const port = process.env.PORT || 5000;

const sip = new SipManager(io);

app.get('/health', (_req: any, res: any) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeCalls: sip.getActiveCallCount(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (_req: any, res: any) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeCalls: sip.getActiveCallCount(),
  });
});

app.get('/api/calls', async (req, res) => {
  try {
    const calls = await sip.getDb().getCalls();
    res.json(calls);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener llamadas' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await sip.getDb().getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
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

app.get('/api/tickets', async (req, res) => {
  try {
    const tickets = await sip.getDb().getTickets();
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tickets' });
  }
});

app.post('/api/tickets/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await sip.getDb().updateTicketStatus(parseInt(req.params.id), status);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar ticket' });
  }
});

app.post('/api/admin/cleanup', async (req, res) => {
  try {
    await sip.getDb().cleanupAbandonedCalls();
    res.json({ success: true, message: 'Limpieza completada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al ejecutar limpieza' });
  }
});

app.get('/api/blacklist', async (req, res) => {
  try {
    const list = await sip.getDb().getBlacklist();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener blacklist' });
  }
});

app.post('/api/blacklist', async (req, res) => {
  try {
    const { phone_number, description } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number requerido' });
    await sip.getDb().addBlacklist(phone_number, description || '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar a blacklist' });
  }
});

app.delete('/api/blacklist/:id', async (req, res) => {
  try {
    await sip.getDb().removeBlacklist(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar de blacklist' });
  }
});

app.get('/api/settings/security_mode', async (req, res) => {
  try {
    const mode = await sip.getDb().getSecurityMode();
    res.json({ mode });
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo modo de seguridad' });
  }
});

app.post('/api/settings/security_mode', async (req, res) => {
  try {
    const { mode } = req.body;
    if (mode !== 'blacklist' && mode !== 'whitelist') {
      return res.status(400).json({ error: 'Modo inválido' });
    }
    await sip.getDb().setSecurityMode(mode);
    res.json({ success: true, mode });
  } catch (error) {
    res.status(500).json({ error: 'Error actualizando modo de seguridad' });
  }
});

app.get('/api/agents', async (req, res) => {
  try {
    const list = await sip.getDb().getAgents();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo agentes' });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    await sip.getDb().addAgent(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error agregando agente' });
  }
});

app.put('/api/agents/:id', async (req, res) => {
  try {
    await sip.getDb().updateAgent(parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error actualizando agente' });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  try {
    await sip.getDb().deleteAgent(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error eliminando agente' });
  }
});

app.put('/api/agents/:id/master-prompt', async (req, res) => {
  try {
    await sip.getDb().updateAgentMasterPrompt(parseInt(req.params.id), req.body.master_prompt);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error actualizando master prompt' });
  }
});

app.get('/api/agents/:id/documents', async (req, res) => {
  try {
    const docs = await sip.getDb().getAgentDocuments(parseInt(req.params.id));
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo documentos' });
  }
});

app.post('/api/agents/:id/documents', upload.single('file'), async (req: any, res: any) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

    const agentId = parseInt(req.params.id);
    const agents = await sip.getDb().getAgents();
    const agent = agents.find((a: any) => a.id === agentId);
    if (!agent) return res.status(404).json({ error: 'Agente no encontrado' });
    if (!agent.groq_api_key)
      return res
        .status(400)
        .json({ error: 'Debe configurar una API Key de Groq para este agente antes de subir documentos' });

    let rawText = '';
    if (req.file.mimetype === 'application/pdf') {
      const pdfData = await ((pdfModule as any).default || pdfModule)(req.file.buffer);
      rawText = pdfData.text;
    } else {
      const docxData = await mammoth.extractRawText({ buffer: req.file.buffer });
      rawText = docxData.value;
    }

    if (!rawText.trim()) {
      return res.status(400).json({ error: 'No se pudo extraer texto del archivo' });
    }

    const groq = new Groq({ apiKey: agent.groq_api_key });
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'Actúa como un estructurador de datos. Resume y organiza este texto de forma que un Agente Telefónico de IA pueda consumirlo fácil y rápidamente como base de conocimiento. Mantén todos los datos duros, horarios y reglas.',
        },
        { role: 'user', content: rawText },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
    });

    const extractedContent = chatCompletion.choices[0]?.message?.content || rawText.substring(0, 500);

    await sip.getDb().addAgentDocument(agentId, req.file.originalname, extractedContent);
    res.json({ success: true, message: 'Documento procesado correctamente' });
  } catch (error: any) {
    logger.error('Error procesando documento', { error: error.message });
    res.status(500).json({ error: error.message || 'Error interno procesando documento' });
  }
});

app.post('/api/demo/fishaudio', async (req, res) => {
  try {
    const { apiKey, referenceId, text } = req.body;
    if (!apiKey || !text) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }
    const client = new FishAudioClient(apiKey, referenceId);
    const audioBuffer = await client.generateDemoMp3(text);

    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error: any) {
    res.status(400).json({
      error: 'Credenciales de FishAudio inválidas o ID incorrecto. Revisa tu API Key y Reference ID.',
    });
  }
});

io.on('connection', (socket) => {
  logger.info('Dashboard cliente conectado', { socketId: socket.id });
  socket.on('disconnect', () => {
    logger.debug('Dashboard cliente desconectado', { socketId: socket.id });
  });
});

server.listen(port, () => {
  logger.info('Servidor iniciado', { port, env: process.env.NODE_ENV || 'development' });

  sip.start().catch((err: any) => {
    logger.error('Error crítico al iniciar SIP', { error: String(err) });
  });

  setInterval(() => {
    sip.getDb().cleanupAbandonedCalls().catch(() => {});
  }, 5 * 60 * 1000);
});

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('Recibida señal de shutdown', { signal });

  setTimeout(() => {
    logger.error('Shutdown forzado por timeout');
    process.exit(1);
  }, 15000);

  try {
    await sip.shutdown();
    logger.info('SIP Manager detenido');
  } catch (err) {
    logger.error('Error deteniendo SIP', { error: String(err) });
  }

  server.close(() => {
    logger.info('Servidor HTTP cerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled rejection', { error: String(reason) });
});
