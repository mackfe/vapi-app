import sip from 'sip';
import { createAuthHeader } from './SipUtils.js';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { getLocalIp } from '../utils/network.js';
import { DbManager } from '../database/DbManager.js';
import { CallSession } from './CallSession.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const SESSION_REFRESH_SEC = 1800;
const HANGUP_GUARD_MS = 5000;

interface SipDialog {
  callIdHeader: string;
  localTag: string;
  remoteTag: string;
  session: CallSession;
  refreshTimer: NodeJS.Timeout | null;
  hangupGuard: NodeJS.Timeout | null;
  ended: boolean;
}

export class SipManager {
  private sipStack: any;
  private db: DbManager;
  private io: any;
  private dialogs: Map<string, SipDialog> = new Map();
  private rtpPortPool: number[] = [];
  private nextRtpPortIdx = 0;

  constructor(io?: any) {
    this.sipStack = sip;
    this.db = new DbManager();
    this.io = io;

    for (let p = 17000; p <= 17500; p += 2) {
      this.rtpPortPool.push(p);
    }
  }

  public getDb(): DbManager {
    return this.db;
  }

  public async start(): Promise<void> {
    await this.db.init();

    logger.info('Iniciando stack SIP');

    const options = {
      port: 5060,
      hostname: '0.0.0.0',
    };

    try {
      this.sipStack.start(options, (request: any) => {
        logger.debug('Petición SIP entrante', {
          method: request.method,
          from: request.headers?.from?.uri,
          callId: request.headers?.['call-id'],
        });
        this.handleRequest(request);
      });

      logger.info('Servidor SIP en modo ESCUCHA (puerto 5060/UDP)');

      const publicIp = process.env.PUBLIC_IP || '200.8.121.19';
      const agents = await this.db.getAgents();
      for (const agent of agents) {
        if (agent.sip_domain && agent.sip_user && agent.sip_password) {
          this.register(agent.sip_domain, agent.sip_user, agent.sip_password, publicIp, agent.name);
        }
      }
    } catch (error) {
      logger.error('Error al iniciar stack SIP', { error: String(error) });
    }
  }

  private register(domain: string, user: string, pass: string, publicIp: string, agentName: string): void {
    const contact = { uri: `sip:${user}@${publicIp}:5060` };
    const callId = uuidv4();

    const request = {
      method: 'REGISTER',
      uri: `sip:${domain}`,
      headers: {
        to: { uri: `sip:${user}@${domain}` },
        from: { uri: `sip:${user}@${domain}`, params: { tag: uuidv4() } },
        'call-id': callId,
        cseq: { method: 'REGISTER', seq: Math.floor(Math.random() * 1000) },
        contact: [contact],
        'max-forwards': 70,
        expires: 300,
      },
    };

    logger.info('Enviando REGISTER', { domain, user, agent: agentName });

    this.sipStack.send(request, (response: any) => {
      if (response.status === 200) {
        logger.info('REGISTER exitoso', { domain, user, agent: agentName });
      } else if (response.status === 401 || response.status === 407) {
        const authHdr = response.headers['www-authenticate'] || response.headers['proxy-authenticate'];
        if (authHdr) {
          const authHeader = createAuthHeader('REGISTER', request.uri, authHdr, user, pass);
          const authReq = {
            ...request,
            headers: {
              ...request.headers,
              authorization: authHeader,
              cseq: { method: 'REGISTER', seq: request.headers.cseq.seq + 1 },
            },
          };
          this.sipStack.send(authReq, (authResponse: any) => {
            if (authResponse.status === 200) {
              logger.info('REGISTER exitoso (con auth)', { domain, user, agent: agentName });
            } else {
              logger.error('REGISTER falló autenticación', { domain, user, status: authResponse.status });
              if (this.io) this.io.emit('sip-error', { message: 'Fallo de autenticación SIP', status: authResponse.status });
            }
          });
        }
      } else if (response.status >= 400) {
        logger.error('REGISTER error', { domain, user, status: response.status });
        if (this.io) this.io.emit('sip-error', { message: 'Error de respuesta del servidor SIP', status: response.status });
      }
    });
  }

  private handleRequest(request: any): void {
    const method = request.method;
    const callIdHdr = request.headers?.['call-id'];

    if (method === 'INVITE') {
      this.handleInvite(request);
    } else if (method === 'BYE') {
      this.handleBye(request);
    } else if (method === 'CANCEL') {
      logger.info('Llamada cancelada por el llamante', { callId: callIdHdr });
      this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));
      this.handleBye(request);
    } else if (method === 'ACK') {
      this.handleAck(request);
    } else if (method === 'OPTIONS') {
      this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));
    }
  }

  private handleAck(request: any): void {
    const callIdHdr = request.headers?.['call-id'];
    logger.debug('ACK recibido', { callId: callIdHdr });

    const dialog = Array.from(this.dialogs.values()).find(
      (d) => d.callIdHeader === callIdHdr && !d.ended
    );

    if (dialog && !dialog.hangupGuard) {
      dialog.hangupGuard = setTimeout(() => {
        if (!dialog.ended) {
          logger.warn('Hangup guard: no se recibió BYE', { callId: callIdHdr });
          this.cleanupDialog(dialog, 'hangup_guard');
        }
      }, HANGUP_GUARD_MS * 10);
    }
  }

  private async handleInvite(request: any): Promise<void> {
    const callIdHdr = request.headers?.['call-id'];
    const remoteTag = request.headers?.from?.params?.tag;
    const localTag = uuidv4();

    logger.info('INVITE entrante', { callId: callIdHdr });

    this.sipStack.send(this.sipStack.makeResponse(request, 180, 'Ringing'));

    const callerUri = request.headers.from.uri;
    const callerId = callerUri.split(':')[1]?.split('@')[0] || 'Desconocido';

    const securityMode = await this.db.getSecurityMode();
    let isBlocked = false;

    if (securityMode === 'whitelist') {
      const isAllowed = await this.db.isAllowedInWhitelist(callerId);
      if (!isAllowed) {
        logger.info('Llamada bloqueada por whitelist', { callerId });
        isBlocked = true;
      }
    } else {
      isBlocked = await this.db.isBlacklisted(callerId);
      if (isBlocked) {
        logger.info('Llamada bloqueada por blacklist', { callerId });
      }
    }

    if (isBlocked) {
      this.sipStack.send(this.sipStack.makeResponse(request, 403, 'Forbidden'));
      return;
    }

    const toUri = request.headers.to.uri || '';
    const destinationNumber = toUri.split(':')[1]?.split('@')[0];
    const agent = await this.db.getAgentByPhone(destinationNumber);

    if (!agent) {
      logger.warn('Extensión no configurada', { destinationNumber });
      this.sipStack.send(this.sipStack.makeResponse(request, 404, 'Not Found'));
      return;
    }

    const rtpPort = this.rtpPortPool[this.nextRtpPortIdx % this.rtpPortPool.length]!;
    this.nextRtpPortIdx++;

    const docs = await this.db.getAgentDocuments(agent.id);
    const knowledgeContext = docs.map((d: any) => d.extracted_content).join('\n\n');

    const session = new CallSession(callerId, agent, knowledgeContext, rtpPort, this.io, this.db);
    await session.start();

    await this.db.createCall(session.callId, callerId);

    const remoteSdp = request.content || '';
    let ipMatch = remoteSdp.match(/c=IN IP4 ([0-9.]+)/);
    const portMatch = remoteSdp.match(/m=audio ([0-9]+)/);

    if (ipMatch && ipMatch[1] === '0.0.0.0') {
      if (request.headers?.via?.[0]?.host) {
        ipMatch = [ipMatch[0], request.headers.via[0].host];
      }
    }

    if (ipMatch && portMatch) {
      session.rtp.setRemote(ipMatch[1], parseInt(portMatch[1], 10));
    } else {
      logger.warn('No se pudo extraer IP/Puerto del SDP remoto');
    }

    let publicIp = process.env.PUBLIC_IP || '212.56.33.91';
    if (JSON.stringify(request).includes('192.168.')) {
      logger.info('Detectada red local, usando IP interna para audio');
      publicIp = '192.168.1.114';
    }

    const sdp = [
      'v=0',
      `o=- ${Date.now()} ${Date.now()} IN IP4 ${publicIp}`,
      's=-',
      `c=IN IP4 ${publicIp}`,
      't=0 0',
      `m=audio ${session.rtp.getPort()} RTP/AVP 0`,
      'a=rtpmap:0 PCMU/8000',
      'a=sendrecv',
    ].join('\r\n') + '\r\n';

    logger.debug('SDP enviado', { callId: session.callId, sdp: sdp.substring(0, 100) });

    const response = this.sipStack.makeResponse(request, 200, 'OK');
    response.headers.contact = [{ uri: `sip:${process.env.SIP_USER}@${publicIp}:5060` }];
    response.headers['content-type'] = 'application/sdp';
    response.headers.to = { ...response.headers.to, params: { tag: localTag } };
    response.content = sdp;

    this.sipStack.send(response);

    const dialog: SipDialog = {
      callIdHeader: callIdHdr,
      localTag,
      remoteTag,
      session,
      refreshTimer: null,
      hangupGuard: null,
      ended: false,
    };

    dialog.refreshTimer = setInterval(() => {
      if (dialog.ended) {
        if (dialog.refreshTimer) clearInterval(dialog.refreshTimer);
        return;
      }
      this.sendSessionRefresh(dialog);
    }, SESSION_REFRESH_SEC * 1000);

    session.setHangupCallback(() => {
      dialog.ended = true;
      if (dialog.refreshTimer) clearInterval(dialog.refreshTimer);
      if (dialog.hangupGuard) clearTimeout(dialog.hangupGuard);
      this.dialogs.delete(session.callId);
    });

    this.dialogs.set(session.callId, dialog);

    logger.info('Llamada aceptada', {
      callId: session.callId,
      callerId,
      agent: agent.name,
      destinationNumber,
    });

    if (this.io) this.io.emit('call-started', { callerId, agentName: agent.name, callId: session.callId });

    session.playWelcome(agent.name, agent.department);
  }

  private sendSessionRefresh(dialog: SipDialog): void {
    if (dialog.ended) return;

    const config = {
      user: process.env.SIP_USER,
      domain: process.env.SIP_DOMAIN,
    };

    const publicIp = process.env.PUBLIC_IP || '200.8.121.19';
    const sdp = [
      'v=0',
      `o=- ${Date.now()} ${Date.now()} IN IP4 ${publicIp}`,
      's=-',
      `c=IN IP4 ${publicIp}`,
      't=0 0',
      `m=audio ${dialog.session.rtp.getPort()} RTP/AVP 0`,
      'a=rtpmap:0 PCMU/8000',
      'a=sendrecv',
    ].join('\r\n') + '\r\n';

    const request = {
      method: 'INVITE',
      uri: `sip:${dialog.session.callerId}@${process.env.SIP_DOMAIN}`,
      headers: {
        to: {
          uri: `sip:${dialog.session.callerId}@${process.env.SIP_DOMAIN}`,
          params: { tag: dialog.remoteTag },
        },
        from: {
          uri: `sip:${config.user}@${process.env.SIP_DOMAIN}`,
          params: { tag: dialog.localTag },
        },
        'call-id': dialog.callIdHeader,
        cseq: { method: 'INVITE', seq: Math.floor(Math.random() * 1000) + 1000 },
        'max-forwards': 70,
        'session-expires': SESSION_REFRESH_SEC,
        'content-type': 'application/sdp',
      },
      content: sdp,
    };

    this.sipStack.send(request, (response: any) => {
      logger.debug('Session refresh response', {
        callId: dialog.session.callId,
        status: response.status,
      });
    });
  }

  private async handleBye(request: any): Promise<void> {
    const callIdHdr = request.headers?.['call-id'];
    logger.info('BYE recibido', { callId: callIdHdr });

    this.sipStack.send(this.sipStack.makeResponse(request, 200, 'OK'));

    const dialog = Array.from(this.dialogs.values()).find(
      (d) => d.callIdHeader === callIdHdr && !d.ended
    );

    if (!dialog) {
      logger.warn('BYE para diálogo no encontrado o ya finalizado', { callId: callIdHdr });
      return;
    }

    await this.cleanupDialog(dialog, 'remote_bye');
  }

  private async cleanupDialog(dialog: SipDialog, reason: string): Promise<void> {
    if (dialog.ended) return;
    dialog.ended = true;

    if (dialog.refreshTimer) clearInterval(dialog.refreshTimer);
    if (dialog.hangupGuard) clearTimeout(dialog.hangupGuard);

    await dialog.session.hangup(reason);

    this.dialogs.delete(dialog.session.callId);
  }

  public getActiveCallCount(): number {
    let count = 0;
    for (const d of this.dialogs.values()) {
      if (!d.ended) count++;
    }
    return count;
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutdown SIP Manager');

    for (const dialog of this.dialogs.values()) {
      if (!dialog.ended) {
        await this.cleanupDialog(dialog, 'server_shutdown');
      }
    }
    this.dialogs.clear();
  }
}
