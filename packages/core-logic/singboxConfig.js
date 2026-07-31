'use strict';
// Builds sing-box's native JSON config (https://sing-box.sagernet.org/configuration/)
// -- this is the sing-box-shaped replacement for the old xrayConfig.cjs, which
// built xray-core's JSON schema instead. sing-box natively covers VLESS/Trojan/
// Shadowsocks/Hysteria2 plus a real cross-platform TUN inbound, which is why the
// engine moved off xray-core (see electron/lib/singboxProcess.cjs).

// sing-box has no kcp/mkcp transport and no xray-style "tcp http header"
// obfuscation -- both are xray/v2ray-specific. A kcp profile can't be tunneled
// at all; an http-obfuscated tcp profile still connects, just as plain tcp
// (only the disguise is lost), so that one degrades instead of throwing.
function transportSettings(p) {
  switch (p.network) {
    case 'ws':
      return { type: 'ws', path: p.path || '/', headers: p.host ? { Host: p.host } : undefined };
    case 'grpc':
      return { type: 'grpc', service_name: p.serviceName || '' };
    case 'h2':
    case 'http':
      return { type: 'http', path: p.path || '/', host: p.host ? [p.host] : undefined };
    case 'httpupgrade':
      return { type: 'httpupgrade', path: p.path || '/', host: p.host || undefined };
    case 'kcp':
      throw new Error('KCP transport is not supported by the sing-box engine');
    case 'tcp':
    default:
      return undefined; // no transport wrapper = raw TCP
  }
}

function tlsSettings(p) {
  if (p.security !== 'tls' && p.security !== 'reality') return undefined;
  const tls = {
    enabled: true,
    server_name: p.sni || p.address,
    insecure: !!p.allowInsecure,
  };
  if (p.alpn) tls.alpn = p.alpn.split(',').map((s) => s.trim()).filter(Boolean);
  if (p.fingerprint) tls.utls = { enabled: true, fingerprint: p.fingerprint };
  if (p.security === 'reality') {
    tls.reality = {
      enabled: true,
      public_key: p.publicKey || '',
      short_id: p.shortId || '',
    };
    // Reality requires a uTLS fingerprint; default to chrome if none was given.
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' };
  }
  return tls;
}

function buildOutbound(p) {
  const transport = transportSettings(p);
  switch (p.protocol) {
    case 'vmess':
      return {
        type: 'vmess',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        uuid: p.uuid,
        security: p.scy || 'auto',
        alter_id: p.alterId || 0,
        tls: tlsSettings(p),
        transport,
      };
    case 'vless':
      return {
        type: 'vless',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        uuid: p.uuid,
        flow: p.flow || undefined,
        packet_encoding: 'xudp',
        tls: tlsSettings(p),
        transport,
      };
    case 'trojan':
      return {
        type: 'trojan',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        password: p.password,
        tls: tlsSettings(p) || { enabled: true, server_name: p.sni || p.address },
        transport,
      };
    case 'shadowsocks':
      return {
        type: 'shadowsocks',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        method: p.method,
        password: p.password,
      };
    case 'ssh':
      // sing-box has a native `ssh` outbound (confirmed via `sing-box
      // check`), so a plain SSH-tunneled proxy runs through the same
      // engine as everything else -- no separate ssh2/socks stack needed.
      return {
        type: 'ssh',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        user: p.username,
        password: p.password,
      };
    case 'hysteria2': {
      const out = {
        type: 'hysteria2',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        password: p.password,
        tls: tlsSettings({ ...p, security: 'tls' }) || { enabled: true, server_name: p.sni || p.address, insecure: !!p.allowInsecure },
      };
      if (p.obfsPassword) out.obfs = { type: 'salamander', password: p.obfsPassword };
      if (p.upMbps) out.up_mbps = Number(p.upMbps);
      if (p.downMbps) out.down_mbps = Number(p.downMbps);
      return out;
    }
    case 'mtproto':
      // MTProto proxies are consumed directly by Telegram (server/port/secret) --
      // they aren't a tunnel this app can carry system traffic through.
      throw new Error('MTProto profiles cannot be tunneled; connect through Telegram directly.');
    case 'wireguard':
      // WireGuard isn't a regular sing-box "outbound" -- see buildWireguardEndpoint
      // and its use in buildSingboxConfig below.
      throw new Error('WireGuard profiles are built as an endpoint, not an outbound.');
    default:
      throw new Error(`Unsupported protocol: ${p.protocol}`);
  }
}

// WireGuard is modeled as a sing-box "endpoint" (its own top-level config
// section), not an "outbound" like every other protocol here -- confirmed
// against the bundled sing-box binary's schema (`sing-box check`), which
// also confirmed this build needs the with_wireguard and with_gvisor tags
// to actually run one, not just accept the config shape.
function buildWireguardEndpoint(p) {
  const peer = {
    address: p.address,
    port: p.port,
    public_key: p.peerPublicKey,
    allowed_ips: p.allowedIps && p.allowedIps.length ? p.allowedIps : ['0.0.0.0/0', '::/0'],
  };
  if (p.presharedKey) peer.pre_shared_key = p.presharedKey;
  if (p.keepalive) peer.persistent_keepalive_interval = Number(p.keepalive);

  return {
    type: 'wireguard',
    tag: 'proxy',
    address: p.localAddress && p.localAddress.length ? p.localAddress : ['172.16.0.2/32'],
    private_key: p.privateKey,
    peers: [peer],
  };
}

function buildSingboxConfig(profile, opts = {}) {
  const socksPort = opts.socksPort || 10808;
  const httpPort = opts.httpPort || 10809;
  const socksHost = opts.socksHost || '127.0.0.1';
  const httpHost = opts.httpHost || '127.0.0.1';
  const mode = opts.mode || 'proxy'; // 'proxy' | 'tun'

  const inbounds = [];

  const socksIn = { type: 'socks', tag: 'socks-in', listen: socksHost, listen_port: socksPort };
  if (opts.socksAccounts && opts.socksAccounts.length) {
    socksIn.users = opts.socksAccounts.map((a) => ({ username: a.user, password: a.pass }));
  }
  inbounds.push(socksIn);

  const httpIn = { type: 'http', tag: 'http-in', listen: httpHost, listen_port: httpPort };
  if (opts.httpAccounts && opts.httpAccounts.length) {
    httpIn.users = opts.httpAccounts.map((a) => ({ username: a.user, password: a.pass }));
  }
  inbounds.push(httpIn);

  if (mode === 'tun') {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      // Windows ignores interface_name (wintun picks its own); macOS/Linux use
      // it. `process` is a Node/Electron global, absent in a React Native
      // renderer -- guarded so this module still loads there (mobile has its
      // own native VPN path and never actually hits TUN mode through here).
      interface_name: (typeof process !== 'undefined' && process.platform === 'win32') ? undefined : 'scTun0',
      address: ['172.19.0.1/30'],
      mtu: 1500,
      auto_route: true,
      strict_route: true,
      stack: 'system',
    });
  }

  const isWireguard = profile.protocol === 'wireguard';

  const outbounds = [
    { type: 'direct', tag: 'direct' },
    { type: 'block', tag: 'block' },
  ];
  if (!isWireguard) outbounds.unshift(buildOutbound(profile));

  const config = {
    // sing-box has no 'none' level -- 'none' instead disables logging outright.
    log: opts.logLevel === 'none' ? { disabled: true } : { level: opts.logLevel || 'warn', timestamp: true },
    inbounds,
    outbounds,
    route: {
      // Protocol sniffing (destination-domain detection for routing) moved from
      // a per-inbound `sniff` flag to a rule action as of sing-box 1.13.
      rules: [
        { action: 'sniff' },
        { ip_is_private: true, outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
    },
  };

  if (isWireguard) config.endpoints = [buildWireguardEndpoint(profile)];

  // Traffic stats: sing-box's v2ray_api compatibility layer exposes the same
  // StatsService gRPC contract xray-core does, which statsApi.cjs polls for
  // live upload/download counters on the 'proxy' outbound. Endpoints (used
  // for WireGuard) aren't outbounds, so this compatibility layer may not
  // report live speed for a WireGuard connection even though the tunnel
  // itself works -- not verified either way against a real WireGuard peer.
  if (opts.apiPort) {
    config.experimental = {
      v2ray_api: {
        listen: `127.0.0.1:${opts.apiPort}`,
        stats: { enabled: true, outbounds: ['proxy'] },
      },
    };
  }

  return config;
}

module.exports = { buildSingboxConfig };
