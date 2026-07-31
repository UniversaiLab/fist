'use strict';

const { encodeFistBundle, decodeFistBundle, isFistBundle } = require('./fistFormat.js');

function b64decode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function looksBase64(s) {
  return /^[A-Za-z0-9+/_\-=\s]+$/.test(s.trim());
}

// Plain Math.random() rather than Node's crypto module: these are opaque
// local identifiers, not security tokens, and keeping this dependency-free
// is what lets this package run unmodified in a React Native renderer too.
function newId() {
  let id = '';
  for (let i = 0; i < 16; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

function safeUrl(link) {
  try { return new URL(link); } catch { return null; }
}

function q(u, key) {
  const v = u.searchParams.get(key);
  return v == null ? '' : v;
}

function baseProfile(protocol, link) {
  return {
    id: newId(),
    protocol,
    link,
    name: '',
    address: '',
    port: 443,
    network: 'tcp',
    security: 'none',
    sni: '',
    alpn: '',
    fingerprint: '',
    allowInsecure: false,
    host: '',
    path: '',
    headerType: 'none',
    serviceName: '',
    mode: '',
    createdAt: Date.now(),
    subId: null,
  };
}

function parseVmess(link) {
  const body = link.slice('vmess://'.length);
  let obj;
  try {
    obj = JSON.parse(b64decode(body));
  } catch {
    return null;
  }
  if (!obj || !obj.add || !obj.id) return null;
  const p = baseProfile('vmess', link);
  p.name = obj.ps || `${obj.add}:${obj.port}`;
  p.address = String(obj.add);
  p.port = Number(obj.port) || 443;
  p.uuid = String(obj.id);
  p.alterId = Number(obj.aid) || 0;
  p.scy = obj.scy || 'auto';
  p.network = obj.net || 'tcp';
  p.headerType = obj.type || 'none';
  p.host = obj.host || '';
  p.path = obj.path || '';
  p.security = obj.tls === 'tls' ? 'tls' : 'none';
  p.sni = obj.sni || '';
  p.alpn = obj.alpn || '';
  p.fingerprint = obj.fp || '';
  return p;
}

function fillFromQuery(p, u) {
  p.network = q(u, 'type') || 'tcp';
  p.security = q(u, 'security') || p.security || 'none';
  p.sni = q(u, 'sni') || q(u, 'peer') || '';
  p.alpn = q(u, 'alpn') || '';
  p.fingerprint = q(u, 'fp') || '';
  p.host = q(u, 'host') || '';
  p.path = q(u, 'path') || '';
  p.headerType = q(u, 'headerType') || 'none';
  p.serviceName = q(u, 'serviceName') || '';
  p.mode = q(u, 'mode') || '';
  p.allowInsecure = q(u, 'allowInsecure') === '1' || q(u, 'allowInsecure') === 'true';
  p.publicKey = q(u, 'pbk') || '';
  p.shortId = q(u, 'sid') || '';
  p.spiderX = q(u, 'spx') || '';
}

function parseVless(link) {
  const u = safeUrl(link);
  if (!u || !u.username || !u.hostname) return null;
  const p = baseProfile('vless', link);
  p.uuid = decodeURIComponent(u.username);
  p.address = u.hostname.replace(/^\[|\]$/g, '');
  p.port = Number(u.port) || 443;
  p.name = decodeURIComponent(u.hash.slice(1)) || `${p.address}:${p.port}`;
  fillFromQuery(p, u);
  p.flow = q(u, 'flow') || '';
  p.encryption = q(u, 'encryption') || 'none';
  return p;
}

function parseTrojan(link) {
  const u = safeUrl(link);
  if (!u || !u.username || !u.hostname) return null;
  const p = baseProfile('trojan', link);
  p.password = decodeURIComponent(u.username);
  p.address = u.hostname.replace(/^\[|\]$/g, '');
  p.port = Number(u.port) || 443;
  p.name = decodeURIComponent(u.hash.slice(1)) || `${p.address}:${p.port}`;
  p.security = 'tls';
  fillFromQuery(p, u);
  if (!q(u, 'security')) p.security = 'tls';
  return p;
}

function parseSS(link) {
  let rest = link.slice('ss://'.length);
  let name = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    name = decodeURIComponent(rest.slice(hashIdx + 1));
    rest = rest.slice(0, hashIdx);
  }
  const queryIdx = rest.indexOf('?');
  if (queryIdx >= 0) rest = rest.slice(0, queryIdx);

  let method, password, address, port;
  const atIdx = rest.lastIndexOf('@');
  if (atIdx >= 0) {
    // SIP002: ss://base64url(method:password)@host:port
    let userinfo = rest.slice(0, atIdx);
    const hostpart = rest.slice(atIdx + 1);
    let decoded;
    try {
      decoded = b64decode(userinfo);
      if (!decoded.includes(':')) decoded = decodeURIComponent(userinfo);
    } catch {
      decoded = decodeURIComponent(userinfo);
    }
    const ci = decoded.indexOf(':');
    if (ci < 0) return null;
    method = decoded.slice(0, ci);
    password = decoded.slice(ci + 1);
    const m = hostpart.match(/^\[?([^\]]+?)\]?:(\d+)$/);
    if (!m) return null;
    address = m[1];
    port = Number(m[2]);
  } else {
    // Legacy: ss://base64(method:password@host:port)
    let decoded;
    try { decoded = b64decode(rest); } catch { return null; }
    const m = decoded.match(/^(.+?):(.+)@(.+?):(\d+)$/);
    if (!m) return null;
    method = m[1];
    password = m[2];
    address = m[3];
    port = Number(m[4]);
  }
  const p = baseProfile('shadowsocks', link);
  p.method = method;
  p.password = password;
  p.address = address;
  p.port = port;
  p.name = name || `${address}:${port}`;
  return p;
}

// Hysteria2's own URI scheme: hysteria2://[auth]@host:port/?insecure=&sni=&
// obfs=salamander&obfs-password=&pinSHA256=&up=&down=#name -- "hy2://" is an
// accepted alias for the same thing.
function parseHysteria2(link) {
  const u = safeUrl(link);
  if (!u || !u.hostname) return null;
  const p = baseProfile('hysteria2', link);
  p.password = decodeURIComponent(u.username || '');
  p.address = u.hostname.replace(/^\[|\]$/g, '');
  p.port = Number(u.port) || 443;
  p.name = decodeURIComponent(u.hash.slice(1)) || `${p.address}:${p.port}`;
  p.security = 'tls';
  p.sni = q(u, 'sni') || q(u, 'peer') || '';
  p.allowInsecure = q(u, 'insecure') === '1' || q(u, 'insecure') === 'true';
  p.obfsPassword = q(u, 'obfs') && q(u, 'obfs').toLowerCase() !== 'none' ? (q(u, 'obfs-password') || q(u, 'obfsParam') || '') : '';
  p.upMbps = Number(q(u, 'up') || q(u, 'upmbps')) || 0;
  p.downMbps = Number(q(u, 'down') || q(u, 'downmbps')) || 0;
  return p;
}

// MTProto proxies are consumed directly by Telegram (server/port/secret),
// never tunneled system-wide, so this only ever powers parse/store/QR-export
// (see AddModal.jsx/QrModal.jsx), not a connectable profile.
function parseMtproto(link) {
  let server = '';
  let port = 0;
  let secret = '';
  let name = '';
  if (link.startsWith('mtproto://')) {
    const u = safeUrl(link);
    if (!u || !u.hostname) return null;
    server = u.hostname;
    port = Number(u.port) || 443;
    secret = q(u, 'secret') || decodeURIComponent(u.username || '');
    name = decodeURIComponent(u.hash.slice(1)) || '';
  } else {
    // tg://proxy?server=&port=&secret=  or  https://t.me/proxy?server=&port=&secret=
    const u = safeUrl(link);
    if (!u) return null;
    server = q(u, 'server');
    port = Number(q(u, 'port')) || 443;
    secret = q(u, 'secret');
    name = decodeURIComponent(u.hash.slice(1)) || '';
  }
  if (!server || !secret) return null;
  const p = baseProfile('mtproto', link);
  p.address = server;
  p.port = port;
  p.secret = secret;
  p.tunnelable = false;
  p.name = name || `${server}:${port}`;
  return p;
}

// WireGuard has no share-link scheme in real-world use -- every client
// (including the official ones) distributes configs as a wg-quick .conf
// INI file, so that's what we parse here rather than inventing a URI.
function parseWireguardConf(text) {
  const sections = {};
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(\w+)\]$/i);
    if (sectionMatch) {
      current = sectionMatch[1].toLowerCase();
      sections[current] = sections[current] || {};
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    sections[current][key] = value;
  }

  const iface = sections.interface;
  const peer = sections.peer;
  if (!iface || !peer || !iface.privatekey || !peer.publickey || !peer.endpoint) return null;

  const endpointMatch = peer.endpoint.match(/^\[?([^\]]+)\]?:(\d+)$/);
  if (!endpointMatch) return null;

  const p = baseProfile('wireguard', 'wireguard-conf');
  p.address = endpointMatch[1];
  p.port = Number(endpointMatch[2]);
  p.privateKey = iface.privatekey;
  p.localAddress = (iface.address || '').split(',').map((s) => s.trim()).filter(Boolean);
  p.dns = iface.dns || '';
  p.peerPublicKey = peer.publickey;
  p.presharedKey = peer.presharedkey || '';
  p.allowedIps = (peer.allowedips || '0.0.0.0/0,::/0').split(',').map((s) => s.trim()).filter(Boolean);
  p.keepalive = peer.persistentkeepalive ? Number(peer.persistentkeepalive) : undefined;
  p.name = `${p.address}:${p.port}`;
  return p;
}

function parseLink(link) {
  link = String(link || '').trim();
  if (!link) return null;
  try {
    if (link.startsWith('vmess://')) return parseVmess(link);
    if (link.startsWith('vless://')) return parseVless(link);
    if (link.startsWith('trojan://')) return parseTrojan(link);
    if (link.startsWith('ss://')) return parseSS(link);
    if (link.startsWith('hysteria2://') || link.startsWith('hy2://')) return parseHysteria2(link);
    if (link.startsWith('mtproto://')) return parseMtproto(link);
    if (link.startsWith('tg://proxy') || /^https:\/\/t\.me\/proxy/i.test(link)) return parseMtproto(link);
  } catch {
    return null;
  }
  return null;
}

// Smart multi-format entry point used for both pasted text and imported
// files: a .fist bundle (possibly many profiles), a WireGuard .conf (one
// profile), or ordinary share link(s) (one per line) all come through here
// and always come back as an array.
function parseConfigText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (isFistBundle(trimmed)) {
    return decodeFistBundle(trimmed, baseProfile);
  }
  if (/^\[interface\]/im.test(trimmed)) {
    const p = parseWireguardConf(trimmed);
    return p ? [p] : [];
  }
  return parseMany(trimmed);
}

// Parse a block of text: multiple share links, or a base64-encoded
// subscription payload containing one link per line.
function parseMany(text) {
  text = String(text || '').trim();
  if (!text) return [];
  if (!text.includes('://') && looksBase64(text)) {
    try {
      const decoded = b64decode(text);
      if (decoded.includes('://')) text = decoded;
    } catch { /* keep original */ }
  }
  const out = [];
  for (const line of text.split(/[\r\n]+/)) {
    const p = parseLink(line);
    if (p) out.push(p);
  }
  return out;
}

function parseSubscriptionUserinfo(headerValue) {
  if (!headerValue) return null;
  const out = {};
  for (const part of headerValue.split(';')) {
    const [key, val] = part.trim().split('=');
    if (key && val !== undefined && !Number.isNaN(Number(val))) out[key.trim()] = Number(val);
  }
  if (out.upload === undefined && out.download === undefined && out.total === undefined && out.expire === undefined) {
    return null;
  }
  return {
    uploadBytes: out.upload || 0,
    downloadBytes: out.download || 0,
    totalBytes: out.total || 0,
    expireAt: out.expire ? out.expire * 1000 : null,
  };
}

// ---- Custom config: build a share-link back out of a profile object ----
// The reverse of fillFromQuery()/parseVmess() etc. -- lets a manually-built
// (Custom tab) profile carry a real `link`, so copy/QR/edit-via-link keep
// working on it exactly like on any imported profile. Field/default choices
// mirror the parse side field-for-field so a build->parse round trip is a no-op.

function qs(pairs) {
  const parts = [];
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function streamQueryPairs(p) {
  return [
    ['type', p.network && p.network !== 'tcp' ? p.network : undefined],
    ['sni', p.sni || undefined],
    ['alpn', p.alpn || undefined],
    ['fp', p.fingerprint || undefined],
    ['host', p.host || undefined],
    ['path', p.path || undefined],
    ['headerType', p.headerType && p.headerType !== 'none' ? p.headerType : undefined],
    ['serviceName', p.serviceName || undefined],
    ['mode', p.mode || undefined],
    ['allowInsecure', p.allowInsecure ? '1' : undefined],
    ['pbk', p.publicKey || undefined],
    ['sid', p.shortId || undefined],
    ['spx', p.spiderX || undefined],
  ];
}

function buildVmessLink(p) {
  const obj = {
    v: '2',
    ps: p.name || '',
    add: p.address,
    port: p.port,
    id: p.uuid,
    aid: p.alterId || 0,
    scy: p.scy || 'auto',
    net: p.network || 'tcp',
    type: p.headerType || 'none',
    host: p.host || '',
    path: p.path || '',
    tls: p.security === 'tls' ? 'tls' : '',
    sni: p.sni || '',
    alpn: p.alpn || '',
    fp: p.fingerprint || '',
  };
  return `vmess://${Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')}`;
}

function buildVlessLink(p) {
  const pairs = streamQueryPairs(p);
  pairs.push(['security', p.security && p.security !== 'none' ? p.security : undefined]);
  pairs.push(['flow', p.flow || undefined]);
  pairs.push(['encryption', p.encryption && p.encryption !== 'none' ? p.encryption : undefined]);
  const name = encodeURIComponent(p.name || '');
  return `vless://${encodeURIComponent(p.uuid)}@${p.address}:${p.port}${qs(pairs)}#${name}`;
}

function buildTrojanLink(p) {
  const pairs = streamQueryPairs(p);
  // Unlike vless, parseTrojan forces security back to 'tls' whenever the
  // query has no explicit `security` param -- always spell it out here so a
  // deliberately-chosen 'none'/'reality' isn't silently overwritten on reparse.
  pairs.push(['security', p.security || 'tls']);
  const name = encodeURIComponent(p.name || '');
  return `trojan://${encodeURIComponent(p.password)}@${p.address}:${p.port}${qs(pairs)}#${name}`;
}

function buildSsLink(p) {
  const userinfo = b64UrlEncode(`${p.method}:${p.password}`);
  const name = encodeURIComponent(p.name || '');
  return `ss://${userinfo}@${p.address}:${p.port}#${name}`;
}

function b64UrlEncode(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildHysteria2Link(p) {
  const pairs = [
    ['sni', p.sni || undefined],
    ['insecure', p.allowInsecure ? '1' : undefined],
    ['obfs', p.obfsPassword ? 'salamander' : undefined],
    ['obfs-password', p.obfsPassword || undefined],
    ['up', p.upMbps || undefined],
    ['down', p.downMbps || undefined],
  ];
  const name = encodeURIComponent(p.name || '');
  return `hysteria2://${encodeURIComponent(p.password)}@${p.address}:${p.port}${qs(pairs)}#${name}`;
}

function buildMtprotoLink(p) {
  const pairs = [['server', p.address], ['port', p.port], ['secret', p.secret]];
  const name = encodeURIComponent(p.name || '');
  return `tg://proxy${qs(pairs)}#${name}`;
}

function buildLink(p) {
  switch (p.protocol) {
    case 'vmess': return buildVmessLink(p);
    case 'vless': return buildVlessLink(p);
    case 'trojan': return buildTrojanLink(p);
    case 'shadowsocks': return buildSsLink(p);
    case 'hysteria2': return buildHysteria2Link(p);
    case 'mtproto': return buildMtprotoLink(p);
    default: return null;
  }
}

// ---- Custom config: validate manual form input into a full profile ----

const CUSTOM_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const CUSTOM_NETWORKS = new Set(['tcp', 'ws', 'grpc', 'h2', 'http', 'kcp']);
const CUSTOM_SECURITIES = new Set(['none', 'tls', 'reality']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SS_METHODS = new Set([
  'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
  'chacha20-ietf-poly1305', 'chacha20-poly1305', 'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'none', 'plain',
]);

function str(v, max = 256) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function buildCustomProfile(fields) {
  const f = fields || {};
  const protocol = str(f.protocol);
  if (!CUSTOM_PROTOCOLS.has(protocol)) throw new Error('Invalid protocol');

  const address = str(f.address, 253);
  if (!address) throw new Error('Enter the server address');

  const port = Number(f.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');

  const network = str(f.network) || 'tcp';
  if (!CUSTOM_NETWORKS.has(network)) throw new Error('Invalid network type');

  let security = str(f.security) || 'none';
  if (!CUSTOM_SECURITIES.has(security)) throw new Error('Invalid security type');
  if (protocol === 'vmess' && security === 'reality') security = 'tls'; // vmess has no Reality support

  const p = baseProfile(protocol, null);
  p.name = str(f.name, 100);
  p.address = address;
  p.port = port;
  p.network = network;
  p.security = security;
  p.sni = str(f.sni, 253);
  p.alpn = str(f.alpn, 128);
  p.fingerprint = str(f.fingerprint, 32);
  p.allowInsecure = !!f.allowInsecure;
  p.host = str(f.host, 253);
  p.path = str(f.path, 512);
  p.headerType = str(f.headerType) || 'none';
  p.serviceName = str(f.serviceName, 256);
  p.mode = str(f.mode, 32);
  p.publicKey = str(f.publicKey, 128);
  p.shortId = str(f.shortId, 32);
  p.spiderX = str(f.spiderX, 256);

  if (protocol === 'vmess' || protocol === 'vless') {
    const uuid = str(f.uuid);
    if (!UUID_RE.test(uuid)) throw new Error('Invalid UUID (correct format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)');
    p.uuid = uuid;
  }
  if (protocol === 'vmess') {
    const alterId = Number(f.alterId);
    p.alterId = Number.isInteger(alterId) && alterId >= 0 ? alterId : 0;
    p.scy = str(f.scy) || 'auto';
  }
  if (protocol === 'vless') {
    p.flow = str(f.flow);
    p.encryption = str(f.encryption) || 'none';
  }
  if (protocol === 'trojan') {
    const password = str(f.password, 256);
    if (!password) throw new Error('Enter a password');
    p.password = password;
    if (!f.security) p.security = 'tls'; // matches parseTrojan's own forced default
  }
  if (protocol === 'shadowsocks') {
    const method = str(f.method);
    if (!SS_METHODS.has(method)) throw new Error('Invalid encryption method');
    const password = str(f.password, 256);
    if (!password) throw new Error('Enter a password');
    p.method = method;
    p.password = password;
    p.network = 'tcp';
    p.security = 'none';
  }

  if (!p.name) p.name = `${p.address}:${p.port}`;
  p.link = buildLink(p);
  return p;
}

module.exports = {
  parseLink, parseMany, parseConfigText, parseWireguardConf, newId, parseSubscriptionUserinfo,
  buildLink, buildCustomProfile,
  encodeFistBundle: (profiles) => encodeFistBundle(profiles, baseProfile),
};
