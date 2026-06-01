# 5. Calidad de Código

---

## 🟠 ALTO: Uso masivo de `any` types (violando `strict: true`)

| Archivo | Línea(s) | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 21, 27 | `private sipStack: any;` `private io: any;` |
| `backend/src/sip/SipManager.ts` | 365 | `(this as any).currentCallMetrics` — hack para compartir estado |
| `backend/src/index.ts` | 26, 36, 47 | `req: any, res: any, cb: any` |
| `backend/src/index.ts` | 239, 303 | `req: any, res: any` |
| `frontend/src/App.tsx` | 81-84, 106, 1269 | `useState<any[]>` y `selectedTicket: any` |

El `tsconfig.json` tiene `strict: true` y `noUncheckedIndexedAccess: true`, pero el código ignora completamente el tipado. Esto anula todos los beneficios de TypeScript.

---

## 🟠 ALTO: Hack para compartir métricas entre handlers

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 365 | `(this as any).currentCallMetrics = () => metrics;` |
| `backend/src/sip/SipManager.ts` | 373 | `const finalMetrics = (this as any).currentCallMetrics ? (this as any).currentCallMetrics() : ...` |

Para pasar las métricas acumuladas de `handleInvite()` a `handleBye()`, se usa un cast a `any` y se asigna una función a una propiedad dinámica de la instancia. Esto es una señal de que la arquitectura no soporta el flujo de datos necesario.

---

## 🟡 MEDIO: Catch blocks silenciosos que tragan errores

| Archivo | Línea(s) | Problema |
|---|---|---|
| `backend/src/database/DbManager.ts` | 145-147 | `catch (error) { console.error(...) }` sin relanzar |
| `backend/src/database/DbManager.ts` | 157-159, 179-181, 199-200 | Errores de DB logueados pero no propagados |
| `backend/src/database/DbManager.ts` | 228-230, 333-335, 361-363 | Retorna `[]` en error — el llamante no sabe que falló |
| `backend/src/sip/SipManager.ts` | 412-413 | `catch (error) { console.error(...) }` en `generateCallTicket` |

Patrón común:

```typescript
catch (error) {
  console.error('[DB] Error al ...:', error);
  return [];
}
```

El problema es que quien llama a estos métodos recibe un array vacío y no puede distinguir entre "no hay datos" y "error de conexión a DB". Esto puede enmascarar fallos graves.

---

## 🟡 MEDIO: Timer leaks en múltiples paths

| Archivo | Línea(s) | Problema |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 282-338 | `setTimeout` dentro del listener de `audio` — no se limpia si el audio deja de llegar |
| `backend/src/sip/SipManager.ts` | 325-327 | `setInterval` en RTP sin limpiar en errores |
| `backend/src/sip/SipManager.ts` | 343-362 | `setTimeout` de bienvenida sin posibilidad de cancelación |
| `backend/src/index.ts` | 325-327 | `setInterval` de cleanup que nunca se limpia |

Si el `RtpManager` falla mientras hay un `setTimeout` pendiente, los callbacks se ejecutan con estado potencialmente inválido (ej: `this.rtp` es `null` pero el timeout intenta `this.rtp.sendAudio()`).

---

## 🟡 MEDIO: IP pública hardcodeada en SipManager

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/sip/SipManager.ts` | 169 | `let publicIp = process.env.PUBLIC_IP \|\| '212.56.33.91';` |
| `backend/src/sip/SipManager.ts` | 172 | `publicIp = '192.168.1.114';` |

Si no se configura `PUBLIC_IP`, se usa la IP hardcodeada `212.56.33.91` (que parece ser la IP pública del servidor actual). Si el servidor se mueve de IP, el SDP enviado tendrá una IP inválida y las llamadas no tendrán audio.

---

## 🟡 MEDIO: `package.json` usa `latest` para @deepgram/sdk

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/package.json` | 15 | `"@deepgram/sdk": "latest"` |

Usar `"latest"` como versión es una mala práctica. La próxima vez que se haga `npm install` puede romper el sistema si hay breaking changes en la API de Deepgram.

---

## 🟡 MEDIO: `typescript@6.0.2` — versión inestable

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/package.json` | 36 | `"typescript": "^6.0.2"` |
| `frontend/package.json` | — | Misma versión |

TypeScript 6.0 es una versión muy reciente (potencialmente inestable o RC). Además, `tsx` se usa como runtime en lugar de `ts-node` tradicional, y ambos pueden tener incompatibilidades con TS6.

---

## 🟡 MEDIO: `sip@0.0.6` — paquete obscuro sin mantenimiento

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/package.json` | 33 | `"sip": "^0.0.6"` |

`sip@0.0.6` es un paquete npm con versión 0.0.6, 1 estrella, y sin commits recientes. Es un riesgo de seguridad y estabilidad. No provee tipado TypeScript, por eso todo es `any`.

---

## 🟢 BAJO: Título del frontend es "frontend"

| Archivo | Línea | Detalle |
|---|---|---|
| `frontend/index.html` | 7 | `<title>frontend</title>` |

Título de página no configurado para el proyecto.

---

## 🟢 BAJO: Archivos residuales de LLM en el repo

| Archivo | Detalle |
|---|---|
| `docs/documentacion_sistema_voip.md.resolved` | Outputs de asistentes de IA (Copilot/Gemini) commiteados |
| `docs/documentacion_sistema_voip.md.resolved.0` | Lo mismo |
| `docs/documentacion_sistema_voip.md.metadata.json` | Metadatos de generación |

Estos archivos no deberían estar en el repositorio. Engordan el repo sin aportar valor.

---

## 🟢 BAJO: Código muerto y scripts de diagnóstico en `src/`

| Archivo | Detalle |
|---|---|
| `backend/src/check-calls.ts` | Script de diagnóstico para listar calls |
| `backend/src/cleanup-junk.ts` | Script de limpieza one-off |
| `backend/src/test-db.ts` | Test manual de DB |
| `backend/src/test-system.ts` | Test manual de Groq + FishAudio |
| `backend/src/utils/network.ts` | Función `getLocalIp()` que solo se usa en `SipManager.getLocalIp()` que no se usa |

Scripts de diagnóstico mezclados con código de producción. `network.ts` tiene código probablemente no utilizado.
