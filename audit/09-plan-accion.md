# Plan de Acción Recomendado

Priorización por orden de criticidad e impacto en producción.

---

## Fase 0 — Contención Inmediata (Ejecutar Hoy)

| # | Acción | Archivo | Por qué |
|---|---|---|---|
| 0.1 | **Rotar credenciales de DB** y remover `backend/query.ts` del repo (o agregarlo a `.gitignore` y `.dockerignore`) | `backend/query.ts` | Acceso total a DB expuesto |
| 0.2 | **Configurar `JWT_SECRET` fuerte en `.env`** (producción) | `backend/.env` | Sin esto, cualquiera forja tokens |
| 0.3 | **Configurar `DEEPGRAM_API_KEY` en `.env`** | `backend/.env` | Verificar que esté correcta |
| 0.4 | **Verificar que no haya más archivos con credenciales** en el historial de Git | — | `git log -p \| grep -i "password\|secret\|key"` |

---

## Fase 1 — Seguridad (1-2 Semanas)

| # | Acción | Archivo(s) | Esfuerzo |
|---|---|---|---|
| 1.1 | Mover credenciales de login a variables de entorno + tabla de usuarios en DB con bcrypt | `backend/src/index.ts:36-44` | 1 día |
| 1.2 | Agregar autenticación a Socket.io (verificar JWT en handshake) | `backend/src/index.ts:62-64` | 1 día |
| 1.3 | Proteger endpoint `/test-ai` (o eliminarlo) | `backend/src/index.ts:303` | 30 min |
| 1.4 | Agregar rate limiting a todas las rutas (`express-rate-limit`) | `backend/src/index.ts` | 2 horas |
| 1.5 | Agregar validación de requests (Zod o Joi) | `backend/src/index.ts` (todas las rutas) | 1-2 días |
| 1.6 | No loguear API keys en el endpoint de demo | `backend/src/index.ts:287` | 5 min |
| 1.7 | Habilitar SSL en conexión a DB (o al menos `rejectUnauthorized: false`) | `backend/src/database/DbManager.ts:29` | 30 min + config DB |

---

## Fase 2 — Arquitectura (2-4 Semanas)

| # | Acción | Archivo(s) | Esfuerzo |
|---|---|---|---|
| 2.1 | Refactorizar frontend: dividir `App.tsx` en componentes por feature | `frontend/src/App.tsx` | 2-3 días |
| 2.2 | Agregar React Router + lazy loading de rutas | `frontend/src/` | 1 día |
| 2.3 | Refactorizar backend: routers, controllers, services + middleware de errores | `backend/src/index.ts` | 2-3 días |
| 2.4 | Implementar pool de puertos RTP y sesiones por llamada (`CallSession`) | `backend/src/sip/RtpManager.ts`, `SipManager.ts` | 3-5 días |
| 2.5 | Agregar graceful shutdown (SIGTERM/SIGINT handlers) | `backend/src/index.ts` | 1 día |

---

## Fase 3 — Rendimiento y UX (2-4 Semanas)

| # | Acción | Esfuerzo |
|---|---|---|
| 3.1 | Migrar Deepgram a WebSocket streaming para reducir latencia | 2-3 días |
| 3.2 | Agregar jitter buffer en RtpManager | 1-2 días |
| 3.3 | Implementar caché de TTS para respuestas comunes (saludos, despedidas) | 1 día |
| 3.4 | Acotar el historial de mensajes de AiPipeline (sliding window) | 1 día |
| 3.5 | Reemplazar ffmpeg sync con librería JS nativa para transcodificación | 2 días |
| 3.6 | Agregar VAD adaptativo (umbral dinámico) | 1-2 días |

---

## Fase 4 — Operaciones (1-2 Semanas)

| # | Acción | Esfuerzo |
|---|---|---|
| 4.1 | Agregar health checks a Docker Compose | 1 día |
| 4.2 | Agregar tests (unit + integration) con Vitest o Jest | 3-5 días |
| 4.3 | Agregar logger estructurado (Pino) en lugar de console.log | 1 día |
| 4.4 | Agregar soporte para Redis adapter en Socket.io (escalado horizontal) | 1-2 días |
| 4.5 | Configurar backup de PostgreSQL | 1 día |

---

## Fase 5 — Deuda Técnica (1-2 Semanas)

| # | Acción | Esfuerzo |
|---|---|---|
| 5.1 | Eliminar scripts de diagnóstico de `src/` (mover a `scripts/`) | 30 min |
| 5.2 | Remover archivos residuales de LLM (`.md.resolved`, `.metadata.json`) | 5 min |
| 5.3 | Reemplazar `dgram@1.0.1` por `dgram` nativo de Node | 30 min |
| 5.4 | Corregir nombre del título en `frontend/index.html` | 5 min |
| 5.5 | Reemplazar `sip@0.0.6` por stack SIP más robusto (ej: `sipjs` + `drachtio`) | 1-2 semanas |
| 5.6 | Reemplazar `"latest"` en dependencias con versiones fijas | 30 min |

---

## Resumen de Tiempos Estimados

| Fase | Esfuerzo | Prioridad |
|---|---|---|
| Fase 0 — Contención Inmediata | ~2 horas | **URGENTE** |
| Fase 1 — Seguridad | ~1 semana | **ALTA** |
| Fase 2 — Arquitectura | ~3 semanas | ALTA |
| Fase 3 — Rendimiento | ~2 semanas | MEDIA |
| Fase 4 — Operaciones | ~1 semana | MEDIA |
| Fase 5 — Deuda Técnica | ~2 semanas | BAJA |
| **Total estimado** | **~9 semanas** | |

---

> **Nota:** La Fase 0 es requisito indispensable antes de cualquier otro trabajo. La Fase 2 (concurrencia de llamadas) es el problema arquitectónico más grave después de la seguridad.
