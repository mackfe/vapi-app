# 2. Arquitectura

---

## 🔴 CRÍTICO: SipManager no soporta concurrencia

| Archivo | Línea(s) | Problema |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 30-33 | Variables de estado compartidas para toda la clase |
| `backend/src/sip/SipManager.ts` | 149-152 | Limpia el RTP anterior al recibir un nuevo INVITE |
| `backend/src/sip/SipManager.ts` | 252-253 | `this.audioBuffer` y `this.isAiSpeaking` son globales a la instancia |

El `SipManager` es un singleton con estado mutable compartido:

```typescript
// Estado de Llamada (VAD)
private audioBuffer: Buffer = Buffer.alloc(0);
private silenceTimer: NodeJS.Timeout | null = null;
private isAiSpeaking: boolean = false;
```

Si dos llamadas entrantes llegan al mismo tiempo (o mientras una está en curso):
- `this.rtp` se sobrescribe: la primera llamada pierde su socket RTP
- `this.audioBuffer` se mezcla entre ambas llamadas
- `this.silenceTimer` se pierde
- `this.isAiSpeaking` se corrompe

**Esto significa que el sistema colapsa o corrompe datos con más de 1 llamada simultánea.**

---

## 🔴 CRÍTICO: Puerto RTP hardcodeado (1 sola llamada de audio)

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/RtpManager.ts` | 12 | `constructor(port: number = 16384)` |

```typescript
constructor(port: number = 16384) {
```

Solo hay un puerto UDP para RTP. Una segunda llamada no puede crear otro `RtpManager` en el mismo puerto. No hay pool de puertos ni asignación dinámica.

---

## 🟠 ALTO: Backend sin separación por capas

| Archivo | Línea | Problema |
|---|---|---|
| `backend/src/index.ts` | 72-215 | Todas las rutas Express inline sin routers |

El archivo `index.ts` contiene:
- Autenticación
- Todas las rutas CRUD
- Configuración de middleware
- Inicialización de servicios
- Manejo de Socket.io

No hay:
- Routers separados (`callsRouter`, `agentsRouter`, `ticketsRouter`)
- Capa de servicios/controladores
- Middleware de validación
- DTOs o interfaces de request

---

## 🟠 ALTO: Frontend monolítico (1619 líneas en 1 archivo)

| Archivo | Líneas | Problema |
|---|---|---|
| `frontend/src/App.tsx` | 1-1619 | TODO el código de UI en un solo componente |

Contiene:
- Login screen
- Dashboard con gráficos
- Lista de tickets con filtros
- Historial de llamadas con búsqueda
- Settings con 4 sub-tabs (General, Líneas, Seguridad, KB)
- 2 modales (detalle de llamada, detalle de ticket)
- Alerta de llamada entrante
- Componentes helper (`NavItem`, `StatCard`)
- Lógica de negocio (fetching, Socket.io, CRUD)
- ~40 `useState` hooks
- Todas las hojas de estilo inline con Tailwind

No hay:
- React Router
- Componentes separados por archivo
- Lazy loading / code splitting
- Store de estado global
- Tests

---

## 🟠 ALTO: Sin manejo de diálogos SIP

| Archivo | Línea | Problema |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 22 | `private callId: string = uuidv4();` |

El `callId` se comparte entre registros SIP y llamadas. No hay seguimiento de transacciones SIP (CSeq, branch, tags de diálogo). El stack SIP (`sip@0.0.6`) es un paquete obscuro con 1 estrella en npm, sin mantenimiento activo.

---

## 🟡 MEDIO: Sin manejo de errores global

Todas las rutas siguen el mismo patrón:

```typescript
try {
  // lógica
} catch (error) {
  res.status(500).json({ error: '...' });
}
```

No hay un middleware centralizado de error que capture excepciones, loguee con contexto suficiente y responda consistentemente. Esto lleva a:
- Respuestas de error inconsistentes
- Información de debugging insuficiente
- Duplicación masiva de código

---

## 🟡 MEDIO: Sin validación de requests

Ninguna ruta valida el body/params/query recibido. Todo se tipa como `any` para Express:

```typescript
app.post('/api/login', (req: any, res: any) => {
```

No hay:
- Zod, Joi, Yup, o cualquier schema validator
- TypeScript types para requests/responses
- Validación de tipos en runtime

---

## 🟡 MEDIO: Knowledge Base sin embeddings ni búsqueda semántica

| Archivo | Detalle |
|---|---|
| `backend/src/sip/SipManager.ts:238` | `const knowledgeContext = docs.map(d => d.extracted_content).join('\n\n');` |
| `backend/src/ai/Pipeline.ts:31-32` | Se inyecta el texto completo en cada prompt del LLM |

El sistema de RAG:
1. Sube el documento → lo manda a Groq para resumir
2. Concatena TODO el texto resumido de todos los documentos
3. Inyecta ese texto completo en el system prompt de CADA interacción

**Problemas:**
- Para N documentos grandes, el context window crece sin límite
- No hay chunking, embeddings, ni búsqueda semántica
- Cada interacción cuesta tokens de más (documentación incluida siempre)
- No hay forma de priorizar documentos relevantes

---

## 🟡 MEDIO: Sin graceful shutdown

No hay handlers para `SIGTERM`/`SIGINT`. Si el contenedor se detiene:
- Las llamadas en curso se cortan abruptamente
- Los timers (`setInterval` de cleanup, `setTimeout` de timers de voz) quedan colgados
- Los sockets UDP y TCP no se cierran limpiamente

---

## 🟢 BAJO: Socket.io sin namespaces ni rooms

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 217-219 | `io.on('connection', ...)` sin rooms |

Todos los eventos se emiten a TODOS los clientes conectados. No hay diferenciación por agente, sala de monitoreo, o tipo de visualización.

---

## 🟢 BAJO: `dgram` como dependencia npm innecesaria

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/package.json` | 22 | `"dgram": "^1.0.1"` |

`dgram` es un módulo nativo de Node.js. La dependencia npm `dgram@1.0.1` es un wrapper innecesario que no agrega valor y podría causar conflictos.
