import dgram from 'dgram';
import g711 from 'g711';
const { ulawFromPCM, ulawToPCM } = g711;
import { EventEmitter } from 'events';

export class RtpManager extends EventEmitter {
  private server: dgram.Socket;
  private remotePort: number | null = null;
  private remoteAddress: string | null = null;
  private localPort: number;

  constructor(port: number = 16384) {
    super();
    this.localPort = port;
    this.server = dgram.createSocket('udp4');
  }

  public setRemote(address: string, port: number) {
    this.remoteAddress = address;
    this.remotePort = port;
    console.log(`[RTP] Destino remoto configurado manualmente: ${this.remoteAddress}:${this.remotePort}`);
  }

  public async start() {
    return new Promise<void>((resolve, reject) => {
      this.server.on('error', (err) => {
        console.error(`[RTP] Error en socket: ${err.message}`);
        reject(err);
      });

      this.server.on('message', (msg, rinfo) => {
        if (!this.remoteAddress) {
          this.remoteAddress = rinfo.address;
          this.remotePort = rinfo.port;
          console.log(`[RTP] Conectado a cliente remoto: ${this.remoteAddress}:${this.remotePort}`);
        }

        // El paquete RTP tiene una cabecera de 12 bytes
        const payload = msg.slice(12);
        
        // Decodificar G.711 u-law (PT 0) a PCM
        const pcm = Buffer.from(ulawToPCM(payload).buffer);
        this.emit('audio', pcm);
      });

      this.server.bind(this.localPort, () => {
        console.log(`[RTP] Servidor escuchando en puerto ${this.localPort}`);
        resolve();
      });
    });
  }

  public sendAudio(pcmBuffer: Buffer) {
    if (!this.remoteAddress || !this.remotePort) return;

    // Codificar todo el PCM a G.711 u-law
    const encoded = Buffer.from(ulawFromPCM(new Int16Array(pcmBuffer.buffer)));
    
    // Configuración estándar de VoIP: 20ms por paquete (160 bytes a 8000Hz)
    const PAYLOAD_SIZE = 160; 
    let offset = 0;
    
    // El protocolo RTP requiere secuencias y timestamps válidos
    let sequenceNumber = Math.floor(Math.random() * 65535);
    let timestamp = Math.floor(Math.random() * 4294967295);
    const ssrc = 0x12345678;

    // Enviar los paquetes de a poco (Streaming)
    const interval = setInterval(() => {
      if (offset >= encoded.length) {
        clearInterval(interval);
        return;
      }

      // Tomar un fragmento de 160 bytes
      const end = Math.min(offset + PAYLOAD_SIZE, encoded.length);
      const chunk = encoded.slice(offset, end);
      
      // Crear cabecera RTP de 12 bytes
      const rtpHeader = Buffer.alloc(12);
      rtpHeader[0] = 0x80; // V=2
      rtpHeader[1] = 0x00; // PT=0 (PCMU)
      rtpHeader.writeUInt16BE(sequenceNumber, 2);
      rtpHeader.writeUInt32BE(timestamp, 4);
      rtpHeader.writeUInt32BE(ssrc, 8);

      // Unir cabecera con el audio y enviar
      const packet = Buffer.concat([rtpHeader, chunk]);
      this.server.send(packet, this.remotePort!, this.remoteAddress!);

      // Actualizar contadores para el siguiente paquete
      offset += PAYLOAD_SIZE;
      sequenceNumber = (sequenceNumber + 1) % 65536;
      timestamp += PAYLOAD_SIZE; 
    }, 20);
  }

  public getPort() {
    return this.localPort;
  }

  public stop() {
    try {
      this.server.close();
    } catch (e) {
      // Ignorar si el socket ya estaba cerrado
    }
  }
}
