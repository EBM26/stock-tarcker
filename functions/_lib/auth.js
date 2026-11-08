// Signed session cookie: "<expiresMs>.<base64url HMAC-SHA256(expiresMs)>".

export const COOKIE_NAME = 'st_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// Constant-time comparison of two strings (hash first so lengths always match).
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function createSessionCookie(secret) {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const token = `${expires}.${await hmac(secret, `session:${expires}`)}`;
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function isValidSession(request, secret) {
  if (!secret) return false;
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await hmac(secret, `session:${expires}`));
}
