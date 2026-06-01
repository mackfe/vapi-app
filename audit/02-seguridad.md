# 1. Seguridad

---

## 🔴 CRÍTICO: Credenciales de DB en texto plano commiteadas

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/query.ts` | 2-8 | `user: 'vapi_user'`, `host: '212.56.33.91'`, `database: 'vapi_agent_db'`, `password: 'vapi_secure_password'` |

Script independiente que conecta directamente a la DB de producción y expone credenciales en el repositorio de Git. Cualquier persona con acceso al repo tiene credenciales de PostgreSQL.

**Riesgo:** Exfiltración de datos, modificación no autorizada, eliminación de registros.

---

## 🔴 CRÍTICO: JWT secret hardcodeado con fallback débil

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 22 | `const JWT_SECRET = process.env.JWT_SECRET \|\| 'vox-ia-super-secret-2024';` |

Si la variable de entorno `JWT_SECRET` no está definida (o está vacía), se usa un string hardcodeado predecible.

**Riesgo:** Cualquier atacante puede forjar JWTs válidos y obtener acceso administrativo completo.

---

## 🔴 CRÍTICO: Credenciales de login hardcodeadas

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 38 | `email === 'admin@admin' && password === 'vox.ia1234'` |

No hay forma de cambiar las credenciales sin modificar el código fuente y redeployar. No hay tabla de usuarios, no hay hashing de contraseñas, no hay múltiples cuentas.

**Riesgo:** Compromiso total del panel de administración.

---

## 🟠 ALTO: Socket.io sin autenticación

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 62-64 | `cors: { origin: "*" }` + sin `auth` en el handshake |

```typescript
const io = new Server(server, {
  cors: { origin: "*" }
});
```

Cualquier cliente puede conectarse al WebSocket, recibir eventos en tiempo real (`transcription`, `call-started`, `call-ended`, `audio-chunk`, `sip-error`) y escuchar el audio de las llamadas.

**Riesgo:** Escucha de conversaciones en vivo, fuga de información sensible de ciudadanos.

---

## 🟠 ALTO: Endpoint `/test-ai` sin protección

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 303 | No pasa por `verifyToken` |

```typescript
if (req.path === '/login' || req.originalUrl === '/api/login' || req.path === '/test-ai') return next();
```

Cualquier persona puede llamar a `GET /test-ai` y ejecutar el pipeline completo de IA (Groq + FishAudio), consumiendo créditos de las APIs.

**Riesgo:** Consumo no autorizado de APIs de pago, DoS económico.

---

## 🟠 ALTO: SSL deshabilitado en conexión a DB

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/database/DbManager.ts` | 29 | `ssl: false` |

Todo el tráfico entre el backend y PostgreSQL viaja en texto plano.

**Riesgo:** Intercepción de datos en tránsito (especialmente si la DB no está en la misma red).

---

## 🟡 MEDIO: API Keys expuestas en logs

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 287 | `console.log('[FishAudio Demo Payload]', req.body);` |

El endpoint de demo de FishAudio loguea el body completo del request, que incluye `apiKey`.

**Riesgo:** Exposición de API keys en logs de producción.

---

## 🟡 MEDIO: Password SIP visibles en frontend

| Archivo | Línea | Detalle |
|---|---|---|
| `frontend/src/App.tsx` | 1085 | Input de password SIP manejado en el frontend |

Las contraseñas SIP viajan del frontend al backend y se almacenan en texto plano en la tabla `agents`.

**Riesgo:** Cualquier operador del dashboard puede ver o modificar credenciales SIP.

---

## 🟡 MEDIO: Sin rate limiting en ninguna ruta

Ningún endpoint tiene protección contra abuso. Un atacante puede:

- Llamar `POST /api/tickets/:id/status` miles de veces
- Consultar `GET /api/calls` repetidamente para enumerar llamadas
- Pegarle a `POST /api/blacklist` para llenar la DB

**Riesgo:** DoS, brute force de endpoints, degradación del servicio.

---

## 🟡 MEDIO: JWT sin blacklist ni refresh tokens

El token JWT tiene expiración de 24h (`backend/src/index.ts:39`) y no se puede invalidar del lado del servidor. Tampoco hay refresh tokens ni rotación.

**Riesgo:** Si un token se filtra, el atacante tiene acceso por 24h sin posibilidad de revocación.

---

## 🟢 BAJO: CORS abierto en Express

| Archivo | Línea | Detalle |
|---|---|---|
| `backend/src/index.ts` | 19 | `app.use(cors())` |

CORS abierto a cualquier origen. No es crítico porque la API requiere token, pero combinado con el endpoint `/test-ai` sin auth permite consumo desde cualquier dominio.
