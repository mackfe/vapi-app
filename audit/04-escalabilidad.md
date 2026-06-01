# 3. Escalabilidad

---

## 🔴 CRÍTICO: Llamadas concurrentes limitadas a 1

| Componente | Problema | Impacto |
|---|---|---|
| `SipManager` | Estado mutable compartido | Solo 1 llamada activa |
| `RtpManager` | Puerto 16384 hardcodeado | Solo 1 flujo de audio |
| Pool de puertos | No existe | Imposible multiplexar RTP |

Para soportar llamadas concurrentes se necesitaría:
1. Pool de puertos RTP con asignación dinámica
2. Instancias de `CallSession` independientes por llamada (cada una con su VAD, timer, buffer, métricas)
3. Arquitectura basada en sesiones en vez de singleton

---

## 🟠 ALTO: ffmpeg bloquea el event loop de Node.js

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/ai/FishAudioClient.ts` | 83-108 | `ffmpeg(...).on('end', ...)` |

`fluent-ffmpeg` lanza un proceso hijo de ffmpeg para transcodificar MP3 → PCM en CADA respuesta de TTS. Esto ocurre dentro del event loop de Node.js y, para audios largos, puede bloquear temporalmente el procesamiento de otras requests.

**En un escenario de múltiples llamadas, la CPU se saturaría rápidamente con procesos ffmpeg concurrentes.**

---

## 🟠 ALTO: Sin health checks para orquestación

| Archivo | Detalle |
|---|---|
| `docker-compose.yml` | Sin `healthcheck` en ningún servicio |

Los contenedores no reportan su estado de salud. Docker Compose / Swarm / K8s no pueden determinar si el servicio está realmente funcionando (no solo el proceso vivo).

---

## 🟠 ALTO: Sin soporte para sticky sessions / WebSocket horizontal

`Socket.io` está configurado sin adaptador (Redis, NATS, etc.). Si se escala horizontalmente:
- Los WebSockets se conectan a un nodo aleatorio
- Los eventos se emiten solo desde el nodo donde ocurrió la llamada
- Los clientes conectados a otro nodo no reciben eventos en tiempo real

---

## 🟡 MEDIO: Sin caché de respuestas TTS comunes

Cada vez que se saluda a un ciudadano, se llama a FishAudio para generar "Hola, bienvenido...". No hay caché de audios generados. Para N llamadas, se generan N audios idénticos.

---

## 🟡 MEDIO: Pool de conexiones PostgreSQL sin tuning

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 23-30 | `new Pool({...})` con valores default |

El pool de pg usa configuración default (max 10 conexiones, sin timeout, sin idle timeout explícito). Para un sistema con múltiples llamadas concurrentes, 10 conexiones pueden agotarse rápidamente.

---

## 🟡 MEDIO: Sin compresión de audio ni manejo de codecs alternativos

Solo soporta G.711 PCMU (Pulse Code Modulation μ-law). No hay soporte para:
- GSM (uso eficiente de ancho de banda)
- Opus (calidad superior a baja latencia)
- Speex (VAD integrado)
- Negociación de codecs vía SDP

---

## 🟢 BAJO: Deepgram HTTP vs WebSocket Streaming

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/ai/Pipeline.ts` | 60-69 | `axios.post('https://api.deepgram.com/v1/listen', ...)` |

Se usa HTTP POST con el audio completo, en vez de WebSocket streaming. Deepgram ofrece streaming vía WebSocket que permite transcripción en tiempo real mientras el ciudadano habla, reduciendo la latencia percibida.
