# 4. Eficiencia y Performance

---

## 🔴 CRÍTICO: Pipeline de audio secuencial y bloqueante

| Archivo | Líneas | Flujo |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 294-320 | `getTranscription()` → `getAiResponse()` → `textToSpeech()` |

Por cada silencio del ciudadano (2500ms de silencio, línea 338), el sistema ejecuta:

```
1. Deepgram (STT) ─HTTP POST─→ 2. Groq (LLM) ─HTTP POST─→ 3. FishAudio (TTS) ─HTTP POST─→ ffmpeg
```

Cada paso espera al anterior. La latencia total es la SUMA de:
- Deepgram: ~500-1500ms (depende del audio)
- Groq: ~300-2000ms (depende del modelo)
- FishAudio: ~500-1000ms + ffmpeg ~200-500ms

**Latencia total típica: 1.5s - 5s por turno de conversación.** Esto hace que la conversación suene antinatural.

---

## 🟠 ALTO: Deepgram HTTP en vez de WebSocket

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/ai/Pipeline.ts` | 55-76 | Envía WAV completo cada vez |

Cada fragmento de audio se envuelve en un header WAV de 44 bytes y se envía a Deepgram como HTTP POST. Deepgram soporta WebSocket para streaming, lo que permitiría:
- Transcripción continua mientras el ciudadano habla
- Resultados parciales (interim results)
- Cancelación temprana si el ciudadano no dice nada relevante

---

## 🟠 ALTO: ffmpeg ejecutado por cada TTS

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/ai/FishAudioClient.ts` | 83-108 | `convertMp3ToPcm()` |

Cada respuesta TTS:
1. Descarga MP3 de FishAudio (~500ms-1s)
2. Transcodifica MP3 → PCM con ffmpeg (~200-500ms)
3. Fragmenta en paquetes de 160 bytes y los envía con `setInterval` de 20ms

La transcodificación con ffmpeg podría reemplazarse con:
- Solicitar PCM directamente a FishAudio (si lo soporta)
- Cachear la transcodificación (pre-generar audios comunes)
- Usar una librería JS nativa (lamejs, etc.)

---

## 🟡 MEDIO: 2500ms de silencio necesarios para respuesta

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 282-338 | `setTimeout(async () => {...}, 2500)` |

El VAD espera 2.5 segundos de silencio antes de procesar el audio. Esto:
- Es un tiempo excesivo para una conversación natural
- No se adapta dinámicamente al ritmo del hablante
- No considera que el silencio puede ser pensamiento, no fin de turno

Un sistema más eficiente usaría:
- VAD con umbral adaptativo
- Detección de fin de frase (prosodia)
- Timeout dinámico basado en duración del utterance

---

## 🟡 MEDIO: Historial de mensajes sin límite en AiPipeline

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/ai/Pipeline.ts` | 12 | `private messages: any[] = [];` |

```typescript
private messages: any[] = [];
```

El array de mensajes crece sin límite durante la llamada. Para llamadas largas (>30 turnos), el context window de Groq se satura y el costo por token aumenta.

---

## 🟡 MEDIO: Welcome message siempre después de 3 segundos

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 343 | `setTimeout(async () => { ... }, 3000);` |

La bienvenida se reproduce a los 3 segundos de aceptada la llamada, independientemente de si el ciudadano ya comenzó a hablar. Esto causa:
- Superposición de audio (ciudadano + IA hablando al mismo tiempo)
- Mala experiencia de usuario
- Desperdicio de tokens de TTS

---

## 🟡 MEDIO: Umbral VAD fijo (0.005)

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 278 | `if (energy > 0.005)` |

El umbral de detección de voz es fijo. En entornos ruidosos (call center, vía pública) este umbral no es adecuado y puede:
- Detectar ruido como voz (falsos positivos)
- No detectar voz baja (falsos negativos)
- Degradar la calidad de la conversación

---

## 🟡 MEDIO: Fragmentación de audio sin jitter buffer

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/RtpManager.ts` | 69 | `const interval = setInterval(() => { ... }, 20);` |

El audio se envía en paquetes de 160 bytes cada 20ms fijos. No hay:
- Jitter buffer para absorber latencia de red
- Control de congestión
- Reordenamiento de paquetes
- Detección de pérdida de paquetes

---

## 🟢 BAJO: Precios de APIs hardcodeados

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 257-261 | `PRICES = { STT_PER_MIN: 0.0044, LLM_PER_1M_TOKENS: 0.60, TTS_PER_1M_CHARS: 5.00 }` |

Los costos están hardcodeados en el código. Si cambian los precios de Deepgram/Groq/FishAudio, hay que modificar el código y redeployar. No hay consulta dinámica de precios ni configuración externa.
