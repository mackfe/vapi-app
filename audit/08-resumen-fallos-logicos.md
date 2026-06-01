# 7. Fallos Lógicos y de Diseño

---

## 🧠 Fallo: Mala separación de responsabilidades en blacklist/whitelist

| Archivo | Detalle |
|---|---|
| `DbManager.ts:444-462` | `isAllowedInWhitelist()` usa la tabla `blacklist` |

El sistema usa una sola tabla `blacklist` para dos modos de seguridad mutuamente excluyentes. En modo whitelist, los números en `blacklist` se tratan como permitidos. Esto es conceptualmente incorrecto.

---

## 🧠 Fallo: El botón "CONTESTAR" en la alerta de llamada no hace nada

| Archivo | Línea | Detalle |
|---|---|---|
| `frontend/src/App.tsx` | 1526 | `<button onClick={() => setShowCallAlert(false)}>CONTESTAR</button>` |

El botón "CONTESTAR" solo oculta la alerta visual. No envía ningún comando al servidor ni interactúa con la llamada SIP. Es un botón puramente decorativo.

---

## 🧠 Fallo: Login "¿Olvidaste tu contraseña?" no funcional

| Archivo | Línea | Detalle |
|---|---|---|
| `frontend/src/App.tsx` | 521 | `<a href="#">¿Olvidaste tu contraseña?</a>` |

El enlace apunta a `#` y no tiene handler. Es un placeholder que nunca se implementó.

---

## 🧠 Fallo: No hay reintentos en llamadas a APIs externas (Deepgram, Groq, FishAudio)

Si Deepgram o Groq devuelven un error transitorio (rate limit, timeout, 5xx), la llamada telefónica se queda sin transcripción/respuesta. No hay:
- Retry con backoff
- Circuit breaker
- Fallback a modelo más simple

---

## 🧠 Fallo: El dashboard no muestra errores de conexión al usuario

Si falla la conexión a DB o a las APIs de IA, el dashboard simplemente muestra datos vacíos (arrays vacíos, stats en 0). No hay indicadores visuales de estado de salud del sistema backend.

---

## 🧠 Fallo: El TTS usa FishAudio con config `latency: 'balanced'` en vez de `latency: 'low'`

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/ai/FishAudioClient.ts` | 24 | `latency: 'balanced'` |

Para una conversación telefónica en tiempo real, `latency: 'low'` sería más apropiado. La opción `balanced` prioriza calidad sobre velocidad.

---

## 🧠 Fallo: Los precios no se almacenan en DB ni son configurables

Los costos por API están hardcodeados en `SipManager.ts:257-261`. Si cambian los precios, se requiere modificar código y redeployar. No hay granularidad para distintos planes de precios de las APIs.

---

## 🧠 Fallo: La limpieza de llamadas abandonadas cada 5 minutos usa `setInterval` sin control

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 325-327 | `setInterval(() => { ... }, 5 * 60 * 1000);` |

El timer se ejecuta cada 5 minutos indefinidamente, incluso si la DB no está disponible. El `.catch(() => {})` traga cualquier error silenciosamente.
