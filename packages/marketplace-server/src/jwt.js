// Minimal HS256 JWT sign/verify using Node's built-in crypto (available
// under Bun) -- avoids pulling in a whole jsonwebtoken dependency for
// something this small.
import { createHmac, timingSafeEqual } from 'node:crypto';

// A weak signing key means anyone can mint a token for any account, so the
// insecure fallback is allowed only outside production. In production a
// missing/short secret is a hard startup failure rather than a silent
// downgrade nobody notices until tokens are being forged.
const DEV_SECRET = 'dev-insecure-secret-change-me';
const JWT_SECRET = (() => {
  const configured = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!configured || configured === DEV_SECRET) {
      throw new Error('JWT_SECRET must be set to a strong unique value in production');
    }
    if (configured.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
  }
  return configured || DEV_SECRET;
})();
const TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SEC }));
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [header, body, signature] = parts;

  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('invalid signature');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('token expired');
  }
  return payload;
}

export { sign, verify };
