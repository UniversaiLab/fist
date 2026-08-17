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
  // locally and carry the domain inside the tunnel -- no lookup escapes)
  dnsMode: 'off',
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
};

module.exports = { DEFAULT_SETTINGS };
