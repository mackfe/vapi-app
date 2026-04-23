# 📞 Agente VoIP IA - Municipio de 3 de Febrero

Este proyecto es una plataforma integral de telefonía VoIP impulsada por Inteligencia Artificial, diseñada específicamente para automatizar la atención al ciudadano del Municipio de 3 de Febrero (gestión de podas, árboles, etc.). 

El sistema es capaz de contestar llamadas telefónicas reales (SIP), procesar la voz del ciudadano en tiempo real, pensar una respuesta inteligente y hablar de vuelta usando una voz natural, todo en milisegundos. Además, incluye un panel de control (Dashboard) para que los operadores puedan monitorear las llamadas, leer las transcripciones y escuchar el audio en vivo.

---

## 🚀 Características Principales

- **Recepción SIP Nativa:** Se conecta directamente a proveedores de telefonía IP estándar (SIP Trunking) sin depender de plataformas de terceros como Twilio.
- **Ruteo RTP y Transcodificación:** Maneja paquetes UDP de audio crudo, convirtiendo al vuelo formatos de alta calidad de la IA a formatos telefónicos compatibles (G.711 u-law / PCM 8000Hz).
- **Pipeline IA de Ultra Baja Latencia:** Combina tres proveedores de IA líderes para garantizar conversaciones fluidas y sin demoras.
- **Dashboard en Tiempo Real:** Interfaz web para monitorear el estado del servidor SIP, ver el identificador de llamadas (Caller ID), leer la transcripción en vivo de la IA y el ciudadano, y escuchar el audio de la llamada.
- **Manejo de NAT y Firewalls:** Diseñado con técnicas de señalización SIP (SDP Parsing) para operar correctamente detrás de routers en servidores con IPs públicas estáticas.

---

## 🛠️ Stack Tecnológico

### Backend (Servidor y Telefonía)
- **Node.js & TypeScript:** Entorno de ejecución principal.
- **SIP (npm `sip`):** Manejo de la señalización telefónica (INVITE, BYE, OPTIONS, SDP).
- **RTP / Dgram (UDP):** Gestión de sockets para recibir y enviar los paquetes de voz en tiempo real.
- **G.711 & Fluent-FFmpeg:** Librerías para decodificar el audio de las llamadas y transcodificar los audios generados por la IA al formato telefónico crudo (PCM 16-bit 8000Hz).
- **Socket.io:** WebSockets para emitir eventos en tiempo real (llamadas entrantes, audio, transcripciones) hacia el dashboard.

### Inteligencia Artificial (Pipeline)
- **🎙️ Deepgram (STT):** Speech-to-Text. Escucha el audio que entra de la llamada telefónica y lo convierte a texto en tiempo real.
- **🧠 Groq (LLM):** Motor de razonamiento ultra rápido. Recibe el texto del ciudadano y genera la respuesta conversacional adecuada.
- **🗣️ Fish Audio (TTS):** Text-to-Speech. Toma la respuesta de texto de Groq y sintetiza un archivo de audio con voz humana natural y fluida.

### Frontend (Dashboard Operativo)
- **React & TypeScript:** Construcción de la interfaz de usuario.
- **Vite:** Empaquetador ultrarrápido para el entorno de desarrollo.
- **Tailwind CSS:** Diseño moderno y responsivo, adaptado al branding institucional del municipio.
- **Web Audio API:** Reproducción en el navegador de los fragmentos de audio crudo (PCM) transmitidos por WebSockets para "espiar" la llamada en curso.

---

## ⚙️ Variables de Entorno Requeridas (`.env`)

Para que el proyecto funcione, se debe configurar un archivo `.env` en el backend con las siguientes claves:

```env
# Configuración del Proveedor Telefónico (SIP)
SIP_USER=tu_usuario_sip
SIP_PASS=tu_contraseña_sip
SIP_DOMAIN=dominio_o_ip_del_proveedor

# Credenciales de Inteligencia Artificial
DEEPGRAM_API_KEY=tu_api_key_de_deepgram
GROQ_API_KEY=tu_api_key_de_groq
FISHAUDIO_API_KEY=tu_api_key_de_fishaudio
FISHAUDIO_REFERENCE_ID=id_del_modelo_de_voz_clonada
```

---

## 🏗️ Flujo de Funcionamiento (Paso a Paso)

1. **Llamada Entrante:** El ciudadano marca el número municipal. El proveedor SIP envía un `INVITE` al servidor.
2. **Negociación (SDP):** El `SipManager` acepta la llamada, detecta la IP y el puerto de audio del proveedor, y abre el `RtpManager` para empezar a recibir sonido.
3. **Saludo Inicial:** La IA (FishAudio) sintetiza el saludo de bienvenida, se transcodifica usando `ffmpeg` a G.711 y se envía como paquetes RTP al proveedor.
4. **Escucha y Transcripción:** El ciudadano habla. Los paquetes RTP que llegan se decodifican y se envían a Deepgram.
5. **Razonamiento y Respuesta:** El texto de Deepgram pasa a Groq, que decide qué contestar. La respuesta vuelve a FishAudio para generar el audio de salida.
6. **Monitoreo:** Durante todo el proceso, Socket.io envía eventos al Frontend para que el operador vea qué está pasando en tiempo real.

---
*Desarrollado para automatizar la atención ciudadana con tecnología de vanguardia.*