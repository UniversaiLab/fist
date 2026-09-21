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

// Client-side TLS camouflage. Modern DPI fingerprints the ClientHello itself
// (JA3/JA4) -- a stock Go TLS handshake is trivially distinguishable from a
// browser and gets flagged regardless of which protocol rides on top. uTLS
// makes sing-box emit a byte-identical Chrome/Firefox/Safari handshake.
//
// `utlsDefault` is applied only when the profile itself doesn't pin a
// fingerprint, so an explicitly-configured one always wins. Callers that pass
// nothing (the server tester) keep the original behaviour exactly.
// The uTLS fingerprints sing-box actually accepts. Config links in the wild
// carry all sorts of values here -- `fp=unsafe`, `fp=randomised`, vendor
// spellings -- because other clients quietly ignore what they don't know.
// sing-box does NOT: an unknown fingerprint is a fatal startup error
// ("unknown uTLS fingerprint: ..."), so passing one through verbatim turns a
// working server into a config that can't connect at all. Anything
// unrecognised therefore falls back to the app's default instead.
const VALID_FINGERPRINTS = new Set([
  'chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized',
]);

function pickFingerprint(profileFp, utlsDefault) {
  const wanted = String(profileFp || '').trim().toLowerCase();
  if (VALID_FINGERPRINTS.has(wanted)) return wanted;
  const fallback = String(utlsDefault || '').trim().toLowerCase();
  if (VALID_FINGERPRINTS.has(fallback)) return fallback;
  // An explicit 'none' default means "don't emit utls at all"; so does having
  // neither a usable profile value nor a usable default.
  return null;
}

function tlsSettings(p, utlsDefault, tlsOpts) {
  if (p.security !== 'tls' && p.security !== 'reality') return undefined;
  const tls = {
    enabled: true,
    server_name: p.sni || p.address,
    insecure: !!p.allowInsecure,
  };
  if (p.alpn) tls.alpn = p.alpn.split(',').map((s) => s.trim()).filter(Boolean);
  const fp = pickFingerprint(p.fingerprint, utlsDefault);
  if (fp) tls.utls = { enabled: true, fingerprint: fp };
  if (p.security === 'reality') {
    tls.reality = {
      enabled: true,
      public_key: p.publicKey || '',
      short_id: p.shortId || '',
    };
    // Reality requires a uTLS fingerprint; default to chrome if none was given.
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' };
  }
  // TLS-handshake fragmentation, applied at the outbound (not the route
  // action). record_fragment is the cheaper/preferred one per the docs;
  // `fragment` splits at the TCP layer and costs latency. Reality does its own
  // handshake shaping, so we never fragment on top of it.
  if (tlsOpts && p.security !== 'reality') {
    if (tlsOpts.recordFragment) tls.record_fragment = true;
    if (tlsOpts.fragment) { tls.fragment = true; tls.fragment_fallback_delay = '500ms'; }
    // ECH encrypts the ClientHello (SNI included), so a censor whitelisting by
    // server name sees nothing to match. Needs server-published ECH config;
    // opt-in because a server without it will reject the handshake.
    if (tlsOpts.ech) tls.ech = { enabled: true };
  }
  return tls;
}

// SSH outbound auth: password or an inline private key (PEM text), confirmed
// against the bundled sing-box binary's schema (`sing-box check`) -- both
// `password` and `private_key`/`private_key_path`/`private_key_passphrase`
// are valid fields, so a hop can use either without us having to guess.
function sshAuthFields(hop) {
  const out = {};
  if (hop.privateKey) {
    out.private_key = hop.privateKey;
    if (hop.privateKeyPassphrase) out.private_key_passphrase = hop.privateKeyPassphrase;
  } else {
    out.password = hop.password;
  }
  return out;
}

// SSH jump-host chaining (mirrors `ssh -J hop1,hop2,... finalHost` / sshuttle's
// `--ssh-cmd 'ssh -J ...'`): each intermediate hop is its own `ssh` outbound,
// chained via sing-box's `detour` field so hop N's own TCP connection is
// carried over hop N-1's tunnel instead of dialing directly -- confirmed
// valid via `sing-box check`. The final destination becomes the profile's
// own 'proxy'-tagged outbound with its detour pointed at the last hop.
function buildSshJumpOutbounds(jumps) {
  return (jumps || []).map((hop, i) => ({
    type: 'ssh',
    tag: `jump${i}`,
    server: hop.address,
    server_port: hop.port,
    user: hop.username,
    ...sshAuthFields(hop),
    ...(i > 0 ? { detour: `jump${i - 1}` } : {}),
  }));
}

// Protocols that carry a sing-box `multiplex` block. Hysteria2/TUIC do their
// own stream management, and ssh/wireguard/socks/http have no mux concept --
// applying it to those is a config error, so mux is silently skipped for them.
const MUX_PROTOCOLS = new Set(['vless', 'vmess', 'trojan', 'shadowsocks']);

// Multiplexing carries many logical streams over one real connection, so a
// censor sees a single long-lived TLS session instead of a burst of new ones
// (fewer handshakes to fingerprint), and TCP Brutal layers a custom
// congestion-control on top that brute-forces throughput on lossy, high-RTT
// international links -- the "maximum throughput" tier. Both REQUIRE the
// server to have mux/brutal enabled too, which is why this is opt-in: turning
// it on against a server that doesn't support it breaks the connection.
function muxBlock(opts) {
  const m = opts.mux;
  if (!m || !m.enabled) return undefined;
  const block = {
    enabled: true,
    protocol: m.protocol || 'h2mux',
    padding: !!m.padding,
  };
  if (m.maxConnections) block.max_connections = Number(m.maxConnections);
  // Brutal needs both directions declared (Mbps) to size its controller.
  if (m.brutalUp && m.brutalDown) {
    block.brutal = { enabled: true, up_mbps: Number(m.brutalUp), down_mbps: Number(m.brutalDown) };
  }
  return block;
}

function applyPerConnEvasion(out, p, opts) {
  const mux = muxBlock(opts);
  if (mux && MUX_PROTOCOLS.has(p.protocol)) out.multiplex = mux;
  // UDP-over-TCP tunnels UDP inside the TCP stream, so a network that
  // throttles or drops UDP wholesale can't touch it. sing-box only accepts it
  // on shadowsocks; other protocols carry UDP their own way.
  if (opts.udpOverTcp && p.protocol === 'shadowsocks') {
    out.udp_over_tcp = { enabled: true, version: 2 };
  }
  return out;
}

function buildOutbound(p, utlsDefault, tlsOpts) {
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
        tls: tlsSettings(p, utlsDefault, tlsOpts),
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
        tls: tlsSettings(p, utlsDefault, tlsOpts),
        transport,
      };
    case 'trojan':
      return {
        type: 'trojan',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        password: p.password,
        tls: tlsSettings(p, utlsDefault, tlsOpts) || { enabled: true, server_name: p.sni || p.address },
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
      // `detour` (set below in buildSingboxConfig when p.jumps is present)
      // chains this through one or more jump/bastion hosts first.
      return {
        type: 'ssh',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        user: p.username,
        ...sshAuthFields(p),
      };
    case 'socks':
    case 'http':
      // Upstream SOCKS5/HTTP proxies. sing-box has native outbounds for both,
      // so a config whose "server" is just another proxy (common in Xray
      // configs exported by panels) tunnels through the same engine as
      // everything else. Credentials are optional -- many are open relays.
      return {
        type: p.protocol,
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        ...(p.username ? { username: p.username } : {}),
        ...(p.password ? { password: p.password } : {}),
        ...(p.protocol === 'http' && p.security === 'tls'
          ? { tls: tlsSettings(p, utlsDefault, tlsOpts) || { enabled: true, server_name: p.sni || p.address } }
          : {}),
      };
    case 'hysteria2': {
      const out = {
        type: 'hysteria2',
        tag: 'proxy',
        server: p.address,
        server_port: p.port,
        password: p.password,
        tls: tlsSettings({ ...p, security: 'tls' }, utlsDefault, tlsOpts) || { enabled: true, server_name: p.sni || p.address, insecure: !!p.allowInsecure },
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
    case 'raw':
      // Plug-and-play escape hatch for any protocol sing-box supports natively
      // that we haven't hand-built a parser/form for (socks, tuic, naive,
      // shadowtls, anytls, ...): the user pastes sing-box's own outbound JSON
      // shape directly and we run it as-is, just forcing the tag so routing/
      // stats still line up with everything else.
      if (!p.rawOutbound || typeof p.rawOutbound !== 'object') {
        throw new Error('Raw profile is missing its outbound JSON.');
      }
      return { ...p.rawOutbound, tag: 'proxy' };
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

// ---- Censorship-resistance layers ----
//
// Everything below is opt-in through `opts`. With no options passed the
// generated config is byte-for-byte what it was before, which is what keeps
// the server tester (serverTest.cjs) on its original lightweight path.

// Official sing-box rule-sets. Fetched through the tunnel (`download_detour:
// proxy`) rather than directly: in a censored network raw.githubusercontent
// is usually blocked, and pulling them in the clear would also leak exactly
// which geo lists this client cares about.
const RULE_SET_BASE = 'https://raw.githubusercontent.com/SagerNet';

function geoRuleSet(kind, name) {
  // kind: 'geosite' | 'geoip'
  return {
    tag: `${kind}-${name}`,
    type: 'remote',
    format: 'binary',
    url: `${RULE_SET_BASE}/sing-${kind}/rule-set/${kind}-${name}.srs`,
    download_detour: 'proxy',
    update_interval: '168h',
  };
}

// Translate a resolver written as a plain address or URL into sing-box's
// typed DNS-server shape (`{type, server, server_port, path}`).
function dnsServerSpec(address) {
  const raw = String(address || '').trim();
  const m = raw.match(/^([a-z0-9+]+):\/\/([^/]+)(\/.*)?$/i);
  if (!m) {
    // Bare IP/hostname, optionally with a port. IPv6 literals contain colons
    // themselves, so only split on the last one when it looks like a port.
    const bare = raw.match(/^\[([^\]]+)\](?::(\d+))?$/) || raw.match(/^([^:]+):(\d+)$/);
    if (bare) {
      const spec = { type: 'udp', server: bare[1] };
      if (bare[2]) spec.server_port = Number(bare[2]);
      return spec;
    }
    return { type: 'udp', server: raw };
  }
  const scheme = m[1].toLowerCase();
  const hostPort = m[2];
  const path = m[3] || '';
  const hp = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/) || hostPort.match(/^([^:]+)(?::(\d+))?$/);
  const host = hp ? hp[1] : hostPort;
  const port = hp && hp[2] ? Number(hp[2]) : undefined;
  const spec = { type: scheme === 'dot' ? 'tls' : scheme, server: host };
  if (port) spec.server_port = port;
  if ((scheme === 'https' || scheme === 'h3') && path && path !== '/') spec.path = path;
  return spec;
}

// DNS is where most "working" tunnels actually leak. Resolving locally tells
// the ISP every domain you visit before the tunnel is even used, and lets
// them poison answers. Three modes:
//
//   off    - no dns block at all (previous behaviour)
//   secure - resolve everything over DoH *through the tunnel*
//   fakeip - as above, plus hand the OS a synthetic IP immediately and carry
//            the real domain inside the tunnel, so no lookup ever escapes
//            and connection setup doesn't wait on a round trip
function buildDnsConfig(opts) {
  const mode = opts.dnsMode || 'off';
  if (mode === 'off') return undefined;

  const remote = opts.remoteDns || 'https://1.1.1.1/dns-query';
  const local = opts.localDns || '223.5.5.5';

  // sing-box 1.12 replaced the old `address: "<url>"` server shape with typed
  // servers, and deprecated the legacy form for removal in 1.14 -- emit the
  // modern schema so this keeps working across engine upgrades.
  // No `detour` on the direct resolver: sing-box refuses to start when a DNS
  // server detours to a bare direct outbound ("detour to an empty direct
  // outbound makes no sense"), and without a detour it already dials
  // outside the tunnel, which is what "direct resolver" means. Note this is a
  // *runtime* failure -- `sing-box check` accepts the detour form happily, so
  // it only shows up when actually connecting.
  const servers = [
    { ...dnsServerSpec(remote), tag: 'dns-remote', detour: 'proxy' },
    { ...dnsServerSpec(local), tag: 'dns-direct' },
  ];
  const rules = [];

  // Domestic domains resolve on the local resolver so banking/government
  // sites that geo-fence on resolver location keep working.
  if (opts.directRuleSets && opts.directRuleSets.length) {
    rules.push({ rule_set: opts.directRuleSets.map((n) => `geosite-${n}`), server: 'dns-direct' });
  }

  if (mode === 'fakeip') {
    servers.push({
      type: 'fakeip', tag: 'dns-fake',
      inet4_range: '198.18.0.0/15', inet6_range: 'fc00::/18',
    });
    rules.push({ query_type: ['A', 'AAAA'], server: 'dns-fake' });
  }

  const dns = {
    servers,
    rules,
    final: 'dns-remote',
    strategy: opts.dnsStrategy || 'prefer_ipv4',
    // Keeps fake-IP answers from bleeding into real-resolution caching.
    independent_cache: true,
  };
  return dns;
}

function buildRouteConfig(profile, opts, hasProxy) {
  const rules = [
    // Sniffing has to come first: it recovers the real destination domain
    // from TLS SNI / HTTP Host, which every domain-based rule below depends
    // on -- and under FakeIP it's the only way to know where a synthetic
    // 198.18.x.x address was actually meant to go.
    { action: 'sniff' },
  ];

  // In TUN mode the OS sends DNS to whatever resolver it was handed; hijack
  // it into our own DNS block so nothing escapes to the ISP resolver.
  if (opts.mode === 'tun' && (opts.dnsMode || 'off') !== 'off') {
    rules.push({ protocol: 'dns', action: 'hijack-dns' });
  }

  // Fragmenting the ClientHello across TCP segments splits the SNI so a DPI
  // box doing simple string matching on a single packet cannot see it. Cheap,
  // and effective against SNI blocklists specifically.
  if (opts.tlsFragment) {
    rules.push({ action: 'route-options', tls_fragment: true, tls_fragment_fallback_delay: '500ms' });
  }

  rules.push({ ip_is_private: true, outbound: 'direct' });

  const ruleSets = [];
  if (opts.routingMode === 'smart' && hasProxy) {
    // Split tunnelling: domestic traffic stays on the local network (fast,
    // and avoids tripping fraud detection on banking sites), everything else
    // goes through the tunnel via `final` below.
    for (const name of opts.directRuleSets || []) {
      ruleSets.push(geoRuleSet('geosite', name));
      ruleSets.push(geoRuleSet('geoip', name));
      rules.push({ rule_set: [`geosite-${name}`, `geoip-${name}`], outbound: 'direct' });
    }
    if (opts.blockAds) {
      ruleSets.push(geoRuleSet('geosite', 'category-ads-all'));
      rules.push({ rule_set: ['geosite-category-ads-all'], outbound: 'block' });
    }
  }

  const route = {
    rules,
    final: hasProxy ? (opts.finalOutbound || 'proxy') : 'direct',
    auto_detect_interface: true,
  };
  // Which resolver the engine itself uses to resolve outbound server names.
  // Pinned to the direct resolver so bootstrapping the tunnel never depends
  // on the tunnel already being up.
  if ((opts.dnsMode || 'off') !== 'off') route.default_domain_resolver = 'dns-direct';
  if (ruleSets.length) route.rule_set = ruleSets;
  return route;
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
      // FakeIP hands out addresses from 198.18.0.0/15, so the TUN device has
      // to actually own that range or the OS has nowhere to route them.
      address: (opts.dnsMode === 'fakeip')
        ? ['172.19.0.1/30', '198.18.0.1/15']
        : ['172.19.0.1/30'],
      mtu: 1500,
      auto_route: true,
      // strict_route installs extra policy rules that close leak paths around
      // the tunnel, but it needs IPv6 policy routing to be available. On hosts
      // with IPv6 disabled sing-box dies at startup with "set rules: add rule
      // 0/9: address family not supported by protocol", so the caller can turn
      // it off (main.cjs retries automatically on that failure).
      strict_route: opts.tunStrictRoute !== false,
      // gVisor's userspace netstack (this build has with_gvisor) survives
      // hostile/lossy links better than the system stack and doesn't need the
      // host's TCP stack to cooperate; 'system' stays available as a fallback
      // for anyone who hits compatibility trouble.
      stack: opts.tunStack || 'mixed',
    });
  }

  const isWireguard = profile.protocol === 'wireguard';
  const hasJumps = profile.protocol === 'ssh' && Array.isArray(profile.jumps) && profile.jumps.length > 0;

  const outbounds = [
    { type: 'direct', tag: 'direct' },
    { type: 'block', tag: 'block' },
  ];
  const tlsOpts = {
    fragment: !!opts.tlsHandshakeFragment,
    recordFragment: !!opts.tlsRecordFragment,
    ech: !!opts.ech,
  };
  if (hasJumps) {
    const mainOutbound = applyPerConnEvasion(buildOutbound(profile, opts.utlsFingerprint, tlsOpts), profile, opts);
    mainOutbound.detour = `jump${profile.jumps.length - 1}`;
    outbounds.unshift(mainOutbound, ...buildSshJumpOutbounds(profile.jumps));
  } else if (!isWireguard) {
    outbounds.unshift(applyPerConnEvasion(buildOutbound(profile, opts.utlsFingerprint, tlsOpts), profile, opts));
  }

  // Multi-tier failover: extra profiles become their own outbounds behind a
  // `urltest` group that continuously probes them and routes to whichever is
  // currently alive. This is what survives a censor switching tactics
  // mid-session -- e.g. UDP gets throttled and Hysteria2 dies, so traffic
  // moves to a Reality/TCP tier without the user touching anything.
  let finalTag = null;
  const tiers = Array.isArray(opts.fallbackProfiles) ? opts.fallbackProfiles : [];
  if (tiers.length && !isWireguard) {
    const tierTags = ['proxy'];
    tiers.forEach((tp, i) => {
      let ob;
      try {
        ob = applyPerConnEvasion(buildOutbound(tp, opts.utlsFingerprint, tlsOpts), tp, opts);
      } catch {
        return; // a tier we can't express (kcp, mtproto) just isn't offered
      }
      ob.tag = `tier${i + 1}`;
      tierTags.push(ob.tag);
      outbounds.push(ob);
    });
    if (tierTags.length > 1) {
      outbounds.push({
        type: 'urltest',
        tag: 'auto',
        outbounds: tierTags,
        url: opts.probeUrl || 'https://www.gstatic.com/generate_204',
        interval: opts.probeInterval || '3m',
        tolerance: 50,
        idle_timeout: '30m',
      });
      finalTag = 'auto';
    }
  }

  const config = {
    // sing-box has no 'none' level -- 'none' instead disables logging outright.
    log: opts.logLevel === 'none' ? { disabled: true } : { level: opts.logLevel || 'warn', timestamp: true },
    inbounds,
    outbounds,
    route: buildRouteConfig(profile, { ...opts, mode, finalOutbound: finalTag || opts.finalOutbound }, true),
  };

  const dns = buildDnsConfig(opts);
  if (dns) config.dns = dns;

  if (isWireguard) config.endpoints = [buildWireguardEndpoint(profile)];

  // Traffic stats. Which API we ask for depends on what the binary in front
  // of us was compiled with (see electron/lib/singboxCaps.cjs):
  //
  //   v2ray - the v2ray_api compatibility layer, same StatsService gRPC
  //           contract xray-core exposes. Present in source builds using our
  //           README's tag list.
  //   clash - the Clash-compatible controller, which official sing-box
  //           releases DO ship (they do not ship with_v2ray_api). Its
  //           /connections endpoint carries the same cumulative counters.
  //   none  - neither is compiled in, so emit no API block at all.
  //
  // Getting this wrong is fatal, not cosmetic: sing-box refuses to start if
  // the config names an API its build can't serve, so a config asking for
  // v2ray_api against an official release fails to connect entirely.
  //
  // Endpoints (used for WireGuard) aren't outbounds, so per-outbound stats
  // may not report live speed for a WireGuard connection even though the
  // tunnel itself works -- not verified either way against a real peer.
  const apiKind = opts.apiKind || 'v2ray';
  if (opts.apiPort && apiKind !== 'none') {
    config.experimental = apiKind === 'clash'
      ? {
        clash_api: { external_controller: `127.0.0.1:${opts.apiPort}` },
        // cache_file defaults to writing cache.db into the process's working
        // directory, which is the folder holding the binary -- read-only in a
        // packaged app on macOS/Windows. Pin it to a writable path instead.
        cache_file: {
          enabled: true,
          store_fakeip: opts.dnsMode === 'fakeip',
          ...(opts.cacheFilePath ? { path: opts.cacheFilePath } : {}),
        },
      }
      : {
        v2ray_api: {
          listen: `127.0.0.1:${opts.apiPort}`,
          stats: { enabled: true, outbounds: ['proxy'] },
        },
      };
  }

  return config;
}

module.exports = { buildSingboxConfig };
