import dgram from 'dgram';
import g711 from 'g711';
const { ulawFromPCM, ulawToPCM } = g711;
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

let nextPort = 17000;
const PORT_RANGE_START = 17000;
const PORT_RANGE_END = 17500;

function allocatePort(): number {
  const port = nextPort;
  nextPort++;
  if (nextPort > PORT_RANGE_END) nextPort = PORT_RANGE_START;
  return port;
}

export class RtpManager extends EventEmitter {
  private socket: dgram.Socket;
  private remotePort: number | null = null;
  private remoteAddress: string | null = null;
  private localPort: number;
  private stopped: boolean = false;

  private sendSeq: number = 0;
  private sendTs: number = 0;
  private ssrc: number;
  private sendInterval: NodeJS.Timeout | null = null;

  public _lastRtpInfo: { seq: number } | null = null;

  constructor(port?: number) {
    super();
    this.localPort = port ?? allocatePort();
    this.ssrc = Math.floor(Math.random() * 0xFFFFFFFF);
    this.sendSeq = Math.floor(Math.random() * 65535);
    this.sendTs = Math.floor(Math.random() * 4294967295);

    this.socket = dgram.createSocket('udp4');
    logger.debug('RtpManager creado', { localPort: this.localPort, ssrc: this.ssrc.toString(16) });
  }

  public setRemote(address: string, port: number): void {
    this.remoteAddress = address;
    this.remotePort = port;
    logger.info('RTP destino configurado', { remoteAddress: address, remotePort: port });
  }

  public async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.socket.on('error', (err: Error) => {
        logger.error('Error en socket RTP', { localPort: this.localPort, error: err.message });
        if (!this.stopped) reject(err);
      });

      this.socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        if (this.stopped) return;

        if (!this.remoteAddress) {
          this.remoteAddress = rinfo.address;
          this.remotePort = rinfo.port;
          logger.info('RTP conectado a remoto', { address: rinfo.address, port: rinfo.port });
        }

        if (msg.length < 12) return;

        const seq = msg.readUInt16BE(2);
        this._lastRtpInfo = { seq };

        const payload = msg.slice(12);
        const pcm = Buffer.from(ulawToPCM(payload).buffer);
        this.emit('audio', pcm);
      });

      this.socket.bind(this.localPort, () => {
        logger.info('RTP escuchando', { port: this.localPort });
        resolve();
      });
    });
  }

  public sendAudio(pcmBuffer: Buffer, onComplete?: (active: boolean) => void): void {
    if (!this.remoteAddress || !this.remotePort || this.stopped) {
      if (onComplete) onComplete(false);
      return;
    }

    const encoded = Buffer.from(ulawFromPCM(new Int16Array(pcmBuffer.buffer)));
    const PAYLOAD_SIZE = 160;
    let offset = 0;

    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }

    this.sendInterval = setInterval(() => {
      if (offset >= encoded.length || this.stopped) {
        if (this.sendInterval) {
          clearInterval(this.sendInterval);
          this.sendInterval = null;
        }
        if (onComplete) onComplete(false);
        return;
      }

      const end = Math.min(offset + PAYLOAD_SIZE, encoded.length);
      const chunk = encoded.slice(offset, end);

      const rtpHeader = Buffer.alloc(12);
      rtpHeader[0] = 0x80;
      rtpHeader[1] = 0x00;
      rtpHeader.writeUInt16BE(this.sendSeq, 2);
      rtpHeader.writeUInt32BE(this.sendTs, 4);
      rtpHeader.writeUInt32BE(this.ssrc, 8);

      const packet = Buffer.concat([rtpHeader, chunk]);
      this.socket.send(packet, this.remotePort!, this.remoteAddress!);

      offset += PAYLOAD_SIZE;
      this.sendSeq = (this.sendSeq + 1) % 65536;
      this.sendTs += 160;
    }, 20);
  }

  public getPort(): number {
    return this.localPort;
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;

    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }

    try {
      this.socket.close();
      logger.debug('RTP socket cerrado', { port: this.localPort });
    } catch {
      // socket ya estaba cerrado
    }
  }
}
