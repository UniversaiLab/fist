'use strict';
// .fist is this app's own compact bundle format: one blob (file or
// `fist://` link) that can carry many profiles across any protocol we
// support, using short keys instead of full profile field names. It's a
// direct, lossy-free mapping onto the same profile shape parsers.js
// already produces -- .fist doesn't invent new semantics, just a terser
// wire format for them.
//
// Wire format: "FIST1:" + base64url(JSON.stringify([[t, fields...], ...]))
// Each entry is itself a short array: [type, name, address, port, ...].
// No compression -- base64 alone keeps this dependency-free and portable
// to a future React Native build, where Node's zlib isn't available.

const MAGIC = 'FIST1:';

// One-letter/two-letter protocol codes so the tag itself doesn't eat into
// the "compact" budget.
const TYPE_CODES = {
  vmess: 'vm', vless: 'vl', trojan: 'tr', shadowsocks: 'ss',
  hysteria2: 'hy', wireguard: 'wg', mtproto: 'mt', ssh: 'sh',
};
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPE_CODES).map(([k, v]) => [v, k]));

function b64urlEncode(str) {
  const b64 = typeof Buffer !== 'undefined'
    ? Buffer.from(str, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  return typeof Buffer !== 'undefined'
    ? Buffer.from(padded, 'base64').toString('utf8')
    : decodeURIComponent(escape(atob(padded)));
}

// Shared transport/TLS fields, tacked onto the end of any profile that can
// carry them (everything except wireguard/mtproto).
function packTransport(p) {
  return {
    net: p.network !== 'tcp' ? p.network : undefined,
    sec: p.security !== 'none' ? p.security : undefined,
    sni: p.sni || undefined,
    alpn: p.alpn || undefined,
    fp: p.fingerprint || undefined,
    host: p.host || undefined,
    path: p.path || undefined,
    ht: p.headerType !== 'none' ? p.headerType : undefined,
    sn: p.serviceName || undefined,
    ai: p.allowInsecure ? 1 : undefined,
    pbk: p.publicKey || undefined,
    sid: p.shortId || undefined,
    spx: p.spiderX || undefined,
  };
}

function unpackTransport(p, o) {
  p.network = o.net || 'tcp';
  p.security = o.sec || 'none';
  p.sni = o.sni || '';
  p.alpn = o.alpn || '';
  p.fingerprint = o.fp || '';
  p.host = o.host || '';
  p.path = o.path || '';
  p.headerType = o.ht || 'none';
  p.serviceName = o.sn || '';
  p.allowInsecure = !!o.ai;
  p.publicKey = o.pbk || '';
  p.shortId = o.sid || '';
  p.spiderX = o.spx || '';
}

function encodeProfile(p) {
  const type = TYPE_CODES[p.protocol];
  if (!type) throw new Error(`.fist cannot encode protocol: ${p.protocol}`);
  const o = { t: type, n: p.name, a: p.address, p: p.port };

  switch (p.protocol) {
    case 'vmess':
      Object.assign(o, { id: p.uuid, aid: p.alterId || 0, scy: p.scy || 'auto' }, packTransport(p));
      break;
    case 'vless':
      Object.assign(o, { id: p.uuid, fl: p.flow || undefined, enc: p.encryption || 'none' }, packTransport(p));
      break;
    case 'trojan':
      Object.assign(o, { pw: p.password }, packTransport(p));
      break;
    case 'shadowsocks':
      Object.assign(o, { m: p.method, pw: p.password });
      break;
    case 'hysteria2':
      Object.assign(o, {
        pw: p.password,
        sni: p.sni || undefined,
        ai: p.allowInsecure ? 1 : undefined,
        obfs: p.obfsPassword || undefined,
        up: p.upMbps || undefined,
        down: p.downMbps || undefined,
      });
      break;
    case 'wireguard':
      Object.assign(o, {
        pk: p.privateKey,
        pub: p.peerPublicKey,
        psk: p.presharedKey || undefined,
        addr: p.localAddress,
        dns: p.dns || undefined,
        allow: p.allowedIps,
        ka: p.keepalive || undefined,
      });
      break;
    case 'mtproto':
      Object.assign(o, { sec: p.secret });
      break;
    case 'ssh':
      Object.assign(o, { u: p.username, pw: p.password });
      break;
    default:
      throw new Error(`.fist cannot encode protocol: ${p.protocol}`);
  }

  // Strip undefined keys so they don't serialize as `"key":null`-shaped bloat.
  Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
  return o;
}

function decodeProfile(o, baseProfile) {
  const protocol = TYPE_NAMES[o.t];
  if (!protocol) throw new Error(`.fist: unknown protocol code "${o.t}"`);
  const p = baseProfile(protocol, `fist-bundle:${protocol}`);
  p.name = o.n || '';
  p.address = o.a || '';
  p.port = Number(o.p) || 443;

  switch (protocol) {
    case 'vmess':
      p.uuid = o.id; p.alterId = o.aid || 0; p.scy = o.scy || 'auto';
      unpackTransport(p, o);
      break;
    case 'vless':
      p.uuid = o.id; p.flow = o.fl || ''; p.encryption = o.enc || 'none';
      unpackTransport(p, o);
      break;
    case 'trojan':
      p.password = o.pw;
      unpackTransport(p, o);
      if (!o.sec) p.security = 'tls';
      break;
    case 'shadowsocks':
      p.method = o.m; p.password = o.pw;
      break;
    case 'hysteria2':
      p.password = o.pw;
      p.sni = o.sni || '';
      p.allowInsecure = !!o.ai;
      p.obfsPassword = o.obfs || '';
      p.upMbps = o.up || undefined;
      p.downMbps = o.down || undefined;
      p.security = 'tls';
      break;
    case 'wireguard':
      p.privateKey = o.pk;
      p.peerPublicKey = o.pub;
      p.presharedKey = o.psk || '';
      p.localAddress = o.addr || [];
      p.dns = o.dns || '';
      p.allowedIps = o.allow || ['0.0.0.0/0', '::/0'];
      p.keepalive = o.ka || undefined;
      break;
    case 'mtproto':
      p.secret = o.sec;
      break;
    case 'ssh':
      p.username = o.u;
      p.password = o.pw || '';
      break;
  }
  p.name = p.name || `${p.address}:${p.port}`;
  return p;
}

// baseProfile is injected rather than required directly, so this module
// has no hard dependency edge onto parsers.js (avoids a require cycle --
// parsers.js is the one that will call into this file, not the other way
// around).
function encodeFistBundle(profiles, baseProfile) { // eslint-disable-line no-unused-vars
  const rows = profiles.map(encodeProfile);
  return MAGIC + b64urlEncode(JSON.stringify(rows));
}

function decodeFistBundle(text, baseProfile) {
  const trimmed = text.trim();
  const body = trimmed.startsWith(MAGIC)
    ? trimmed.slice(MAGIC.length)
    : trimmed.startsWith('fist://') ? trimmed.slice('fist://'.length)
      : trimmed;
  let rows;
  try {
    rows = JSON.parse(b64urlDecode(body));
  } catch {
    throw new Error('Invalid .fist file');
  }
  if (!Array.isArray(rows)) throw new Error('Invalid .fist file');
  return rows.map((o) => decodeProfile(o, baseProfile));
}

function isFistBundle(text) {
  const trimmed = text.trim();
  return trimmed.startsWith(MAGIC) || trimmed.startsWith('fist://');
}

module.exports = { encodeFistBundle, decodeFistBundle, isFistBundle };
