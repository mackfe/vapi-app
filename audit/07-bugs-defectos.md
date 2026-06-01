# 6. Bugs y Defectos

---

## 🐛 BUG: `DbManager.endCall()` puede actualizar llamadas ya finalizadas

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 162-182 | `WHERE ended_at IS NULL` |

La query `UPDATE calls SET ... WHERE id = $1 AND ended_at IS NULL` evita finalizar una llamada dos veces. Pero si `handleBye()` se llama dos veces para el mismo `callId` (posible con retransmisiones SIP), el segundo `UPDATE` no modifica nada (por el `ended_at IS NULL`), pero los logs mostrarán "Llamada finalizada en DB" aunque no se haya modificado.

**Impacto:** Confusión en logs. Bajo pero indica manejo de idempotencia ausente.

---

## 🐛 BUG: `isAllowedInWhitelist()` usa tabla `blacklist` en vez de `system_settings`

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 448-456 | `const listCount = await this.pool.query('SELECT COUNT(*) FROM blacklist');` |

El método `isAllowedInWhitelist()` cuenta registros en la tabla `blacklist` y busca en `blacklist` con LIKE. Pero en modo whitelist, los números permitidos deberían estar en una tabla separada o marcados de forma distinta, no en `blacklist`. Si hay números en blacklist, la whitelist los tratará como permitidos.

**Impacto:** El modo whitelist no funciona correctamente — permite números basados en entries de blacklist en vez de entries separadas de whitelist.

---

## 🐛 BUG: Welcome message se reproduce incluso si el ciudadano no contestó

El mensaje de bienvenida se programa con `setTimeout` a los 3 segundos de aceptar el INVITE. Si:
- El ciudadano cuelga antes de los 3 segundos
- La llamada es bloqueada por blacklist/whitelist
- El agente destino no existe

...el timeout sigue ejecutándose. Aunque el bloqueo temprano retorna antes, el `setTimeout` dentro del listener de `audio` (línea 343) podría ejecutarse con un `this.rtp` ya detenido.

---

## 🐛 BUG: `getAgentByPhone()` tiene fallback inseguro

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 476-497 | 3 intentos de matching + fallback a "único agente" |

El método intenta:
1. Match exacto de `phone_number`
2. Match parcial con LIKE inverso
3. **Si hay solo 1 agente en el sistema, se lo asigna a TODAS las llamadas entrantes**

El paso 3 es particularmente peligroso: si hay un solo agente configurado, TODAS las llamadas entrantes (incluso a números no configurados) se enrutan a ese agente. Esto incluye llamadas de bots, escaneos SIP, o números equivocados.

---

## 🐛 BUG: Generación de ticket sin deduplicación

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 393-414 | `generateCallTicket()` se llama siempre |

Si `handleBye()` se ejecuta múltiples veces para la misma llamada (retransmisión SIP), se generarán múltiples tickets para la misma conversación. No hay verificación de si ya existe un ticket para ese `callId`.

---

## 🐛 BUG: `audio-chunk` emite datos de audio por Socket.io sin restricción

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 276 | `if (this.io) this.io.emit('audio-chunk', data);` |
| `backend/src/sip/SipManager.ts` | 321 | `if (this.io) this.io.emit('audio-chunk', audioResponse);` |

Se emiten chunks de audio PCM (del ciudadano) y la respuesta TTS (de la IA) por Socket.io a TODOS los clientes conectados, sin autenticación. Esto filtra el contenido de las conversaciones vía WebSocket a cualquier persona con acceso al dashboard (sin necesidad de la pantalla de transcripción).

---

## 🐛 BUG: Solo se muestra el último agente en `getAgentByPhone` para números similares

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 483 | `"SELECT * FROM agents WHERE $1 LIKE '%' \|\| phone_number"` |

Si hay agentes con números `1234` y `12345`, y llega una llamada a `12345`, el LIKE `'12345' LIKE '%1234'` puede coincidir con el primero. No hay ordenamiento ni priorización.

---

## 🐛 BUG: `cleanupAbandonedCalls()` asigna duración fija de 5 minutos

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 188-201 | `SET ended_at = started_at + INTERVAL '5 minutes'` |

Las llamadas abandonadas reciben una duración fija de 5 minutos en vez de la duración real (desconocida). Esto sesga las estadísticas de duración promedio y costo por minuto.

---

## 🐛 BUG: `isBlacklisted()` usa `phone_number || '%'` en la query

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 377 | `"SELECT * FROM blacklist WHERE $1 LIKE phone_number \|\| '%'"` |

La query busca si el `callerId` empieza con el patrón de blacklist. Si la blacklist tiene `+54%`, entonces `+5491112345678` matchea correctamente. Pero si la blacklist tiene `5411%`, entonces `+5411...` NO matchea porque `+5411... LIKE '5411%'` es falso (falta el `+`). El matching de prefijos internacionales no es confiable.

---

## 🐛 BUG: Welcome message sin try/catch para errores de TTS

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 354 | `const audio = await callTts.textToSpeech(welcome);` |

Si `textToSpeech()` falla y retorna `Buffer.alloc(0)` (como dice su implementación), `sendAudio()` recibe un buffer vacío y no hace nada. Pero `isAiSpeaking` queda en `true` hasta que el timeout (calculado con `audio.length / 16000`) se dispare inmediatamente (porque length es 0). El timeout se ejecuta con `this.isAiSpeaking = false` casi instantáneamente, pero el comportamiento no es intencional.
