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

    // Codificar PCM a G.711 u-law
    const encoded = Buffer.from(ulawFromPCM(new Int16Array(pcmBuffer.buffer)));
    
    // Crear cabecera RTP básica (12 bytes)
    // Para simplificar, usamos valores fijos o incrementales mínimos
    const rtpHeader = Buffer.alloc(12);
    rtpHeader[0] = 0x80; // V=2, P=0, X=0, CC=0
    rtpHeader[1] = 0x00; // M=0, PT=0 (PCMU)
    // ... aquí irían Sequence Number y Timestamp reales ...

    const packet = Buffer.concat([rtpHeader, encoded]);
    this.server.send(packet, this.remotePort, this.remoteAddress);
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
