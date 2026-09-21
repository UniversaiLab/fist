'use strict';
// Shared shape for the app's persisted settings object -- desktop's main.cjs
// uses this as JsonStore's defaults; a future mobile client can reuse the
// same shape for whichever fields apply there (ports/host/kill-switch don't,
// system-proxy-adjacent ones do).

const DEFAULT_SETTINGS = {
  launchOnStartup: false,
  runLocalProxyOnStartup: false, // replaces the old autoConnect (migrated in getSettings())
  startMinimized: false,
  restorePreviousSession: false, // renderer-owned UI state; main just persists/exposes it
  minimizeToTray: true,
  autoReconnect: true,
  killSwitchEnabled: false,
  subAutoUpdateInterval: 0, // ms; 0 = off
  singboxLogLevel: 'warn',
  socksPort: 10808, // preferred; auto-bumped to the next free port if taken
  httpPort: 10809,
  socksHost: '127.0.0.1',
  socksUsername: '',
  socksPassword: '',
  httpHost: '127.0.0.1',
  httpUsername: '',
  httpPassword: '',
  customBypass: '', // extra semicolon-separated hosts/patterns added to the system-proxy bypass list

  // ---- Censorship resistance ----
  // Defaults are chosen to be strictly better than before while changing
  // nothing a user would notice on an unrestricted network. The heavier
  // layers (FakeIP, geo routing, fallback tiers) stay off until asked for,
  // since they trade startup cost or need rule-set downloads.

  // Browser TLS fingerprint to imitate (uTLS). Defeats JA3/JA4 heuristics
  // that flag a stock Go handshake. 'none' restores the raw handshake.
  utlsFingerprint: 'chrome',
  // 'off' | 'secure' (DoH through the tunnel) | 'fakeip' (also answer
  // locally and carry the domain inside the tunnel -- no lookup escapes).
  // Defaults to fakeip: Full Tunnel captures the OS's DNS traffic, so without
  // our own resolver those queries would either go nowhere or leak straight
  // to the ISP's resolver, which is the first thing a censor watches.
  dnsMode: 'fakeip',
  remoteDns: 'https://1.1.1.1/dns-query',
  localDns: '223.5.5.5',
  dnsStrategy: 'prefer_ipv4',
  // Split the TLS ClientHello across segments so SNI keyword matching fails.
  tlsFragment: false,
  // 'global' (everything through the tunnel) | 'smart' (domestic direct)
  routingMode: 'global',
  // geosite/geoip rule-set names kept on the direct route in smart mode.
  directRuleSets: [],
  blockAds: false,
  // 'mixed' (gVisor+system, most resilient) | 'system' | 'gvisor'
  tunStack: 'mixed',
  // Auto-failover across other saved servers when the active one dies.
  autoFallback: false,

  // ---- Advanced sing-box power features (all need SERVER support) ----
  // Off by default: enabling any of these against a server that wasn't set up
  // for it will break that connection, so they're deliberately opt-in.

  // Multiplex many streams over one connection (fewer handshakes to
  // fingerprint) + optional TCP Brutal congestion control for throughput on
  // bad links. Only applies to vless/vmess/trojan/shadowsocks.
  muxEnabled: false,
  muxProtocol: 'h2mux',       // 'h2mux' | 'smux' | 'yamux'
  muxPadding: false,
  muxMaxConnections: 4,
  brutalUpMbps: 0,            // 0 = brutal off; both up+down needed to enable
  brutalDownMbps: 0,
  // Tunnel UDP inside the TCP stream (shadowsocks only) for UDP-hostile
  // networks.
  udpOverTcp: false,
  // TLS-handshake fragmentation at the outbound and ECH (encrypted SNI).
  tlsRecordFragment: false,   // preferred, cheaper
  tlsHandshakeFragment: false,// TCP-level, higher latency
  ech: false,                 // needs server-published ECH config
};

module.exports = { DEFAULT_SETTINGS };
