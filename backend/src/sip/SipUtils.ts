import crypto from 'crypto';

export function createAuthHeader(method: string, uri: string, wwwAuthenticate: string, user: string, pass: string) {
  const parts = wwwAuthenticate.split(',').reduce((acc: any, part) => {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) return acc;
    const key = part.substring(0, eqIdx).trim().toLowerCase();
    const value = part.substring(eqIdx + 1).trim().replace(/"/g, '');
    acc[key] = value;
    return acc;
  }, {});

  const realm = parts.realm;
  const nonce = parts.nonce;
  const opaque = parts.opaque;
  const qop = parts.qop;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');

  const md5 = (str: string) => crypto.createHash('md5').update(str).digest('hex');

  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  
  let response;
  if (qop === 'auth') {
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  let authHeader = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (opaque) authHeader += `, opaque="${opaque}"`;
  if (qop) authHeader += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;

  return authHeader;
}
