import React from 'react';
import Icon from './Icon.jsx';
import { Section, Toggle } from './settingsPrimitives.jsx';

// Controls for the censorship-resistance layers the engine can turn on
// (see core-logic/singboxConfig.js). Grouped by what they defend against, so
// someone under active blocking can reason about which knob to reach for
// rather than guessing at protocol jargon.

const FINGERPRINTS = [
  { value: 'chrome', label: 'Chrome (recommended)' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'safari', label: 'Safari' },
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
  { value: 'edge', label: 'Edge' },
  { value: 'random', label: 'Randomized' },
  { value: 'none', label: 'Off (raw handshake)' },
];

const DNS_MODES = [
  { value: 'off', label: 'Off — use system DNS' },
  { value: 'secure', label: 'Encrypted (DoH through tunnel)' },
  { value: 'fakeip', label: 'FakeIP (fastest, no leaks)' },
];

const DNS_STRATEGIES = [
  { value: 'prefer_ipv4', label: 'Prefer IPv4' },
  { value: 'ipv4_only', label: 'IPv4 only' },
  { value: 'prefer_ipv6', label: 'Prefer IPv6' },
  { value: 'ipv6_only', label: 'IPv6 only' },
];

const TUN_STACKS = [
  { value: 'mixed', label: 'Mixed (most resilient)' },
  { value: 'system', label: 'System' },
  { value: 'gvisor', label: 'gVisor' },
];

// Country rule-sets people most often want left on the direct route. These
// map onto sing-geosite/sing-geoip rule-set names.
const REGIONS = [
  { value: 'ir', label: 'Iran' },
  { value: 'cn', label: 'China' },
  { value: 'ru', label: 'Russia' },
];

export default function EvasionSettings({ settings, connectionState, onUpdate }) {
  const locked = connectionState !== 'disconnected';
  const direct = settings.directRuleSets || [];

  const toggleRegion = (code) => {
    const next = direct.includes(code) ? direct.filter((c) => c !== code) : [...direct, code];
    onUpdate({ directRuleSets: next });
  };

  return (
    <>
      <Section
        title="Camouflage"
        icon="shield"
        description="How the tunnel disguises itself from traffic inspection"
      >
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">TLS fingerprint</span>
            <span className="setting-hint">
              Imitates a real browser's TLS handshake so fingerprinting (JA3/JA4) can't
              single out this app's traffic
            </span>
          </div>
          <select
            className="setting-select"
            value={settings.utlsFingerprint}
            onChange={(e) => onUpdate({ utlsFingerprint: e.target.value })}
          >
            {FINGERPRINTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <Toggle
          label="Split TLS handshake"
          hint="Fragments the ClientHello across packets so filters that match on the server name in a single packet can't see it. Slight latency cost on connect."
          checked={!!settings.tlsFragment}
          onChange={(v) => onUpdate({ tlsFragment: v })}
        />
      </Section>

      <Section
        title="DNS Protection"
        icon="globe"
        description="Stops lookups leaking to (or being poisoned by) the local network"
      >
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Resolver mode</span>
            <span className="setting-hint">
              FakeIP answers instantly and sends the real domain inside the tunnel — no
              lookup ever reaches the local network
            </span>
          </div>
          <select
            className="setting-select"
            value={settings.dnsMode}
            onChange={(e) => onUpdate({ dnsMode: e.target.value })}
            disabled={locked}
          >
            {DNS_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {settings.dnsMode !== 'off' && (
          <>
            <div className="setting-row">
              <div className="setting-text">
                <span className="setting-label">Encrypted resolver</span>
                <span className="setting-hint mono">{settings.remoteDns}</span>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-text">
                <span className="setting-label">IP version</span>
              </div>
              <select
                className="setting-select"
                value={settings.dnsStrategy}
                onChange={(e) => onUpdate({ dnsStrategy: e.target.value })}
                disabled={locked}
              >
                {DNS_STRATEGIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </>
        )}
      </Section>

      <Section
        title="Routing"
        icon="target"
        description="What goes through the tunnel and what stays local"
      >
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Mode</span>
            <span className="setting-hint">
              Smart keeps local banking/government sites on the normal connection and
              tunnels everything else
            </span>
          </div>
          <select
            className="setting-select"
            value={settings.routingMode}
            onChange={(e) => onUpdate({ routingMode: e.target.value })}
            disabled={locked}
          >
            <option value="global">Everything through tunnel</option>
            <option value="smart">Smart split</option>
          </select>
        </div>
        {settings.routingMode === 'smart' && (
          <>
            <div className="setting-row">
              <div className="setting-text">
                <span className="setting-label">Keep direct</span>
                <span className="setting-hint">Region lists downloaded through the tunnel, then cached</span>
              </div>
              <div className="chip-row">
                {REGIONS.map((r) => (
                  <button
                    key={r.value}
                    className={`chip ${direct.includes(r.value) ? 'on' : ''}`}
                    onClick={() => toggleRegion(r.value)}
                    disabled={locked}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <Toggle
              label="Block ads and trackers"
              hint="Drops known ad/tracker domains at the tunnel"
              checked={!!settings.blockAds}
              onChange={(v) => onUpdate({ blockAds: v })}
            />
          </>
        )}
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Full Tunnel network stack</span>
            <span className="setting-hint">Only affects Full Tunnel mode; switch to System if you hit compatibility issues</span>
          </div>
          <select
            className="setting-select"
            value={settings.tunStack}
            onChange={(e) => onUpdate({ tunStack: e.target.value })}
            disabled={locked}
          >
            {TUN_STACKS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </Section>

      <Section
        title="Advanced (needs server support)"
        icon="sliders"
        description="High-power sing-box features — only enable these if your server is configured for them, or the connection will fail"
      >
        <Toggle
          label="Stream multiplexing"
          hint="Carries many streams over one connection, so a censor sees a single long-lived session instead of a burst of new handshakes"
          checked={!!settings.muxEnabled}
          onChange={(v) => onUpdate({ muxEnabled: v })}
        />
        {settings.muxEnabled && (
          <>
            <div className="setting-row">
              <div className="setting-text">
                <span className="setting-label">Mux protocol</span>
              </div>
              <select
                className="setting-select"
                value={settings.muxProtocol}
                onChange={(e) => onUpdate({ muxProtocol: e.target.value })}
                disabled={locked}
              >
                <option value="h2mux">h2mux</option>
                <option value="smux">smux</option>
                <option value="yamux">yamux</option>
              </select>
            </div>
            <Toggle
              label="TCP Brutal"
              hint="Custom congestion control that brute-forces throughput on lossy, high-latency international links. Set your real line speed below."
              checked={settings.brutalDownMbps > 0}
              onChange={(v) => onUpdate(v
                ? { brutalUpMbps: settings.brutalUpMbps || 50, brutalDownMbps: settings.brutalDownMbps || 100 }
                : { brutalUpMbps: 0, brutalDownMbps: 0 })}
            />
            {settings.brutalDownMbps > 0 && (
              <div className="setting-row">
                <div className="setting-text">
                  <span className="setting-label">Line speed (Mbps)</span>
                  <span className="setting-hint">Up / down — set to your actual bandwidth</span>
                </div>
                <div className="chip-row">
                  <input
                    className="mono num-input" type="number" min={1} max={10000}
                    value={settings.brutalUpMbps}
                    onChange={(e) => onUpdate({ brutalUpMbps: Math.max(0, Number(e.target.value) | 0) })}
                    disabled={locked}
                  />
                  <input
                    className="mono num-input" type="number" min={1} max={10000}
                    value={settings.brutalDownMbps}
                    onChange={(e) => onUpdate({ brutalDownMbps: Math.max(0, Number(e.target.value) | 0) })}
                    disabled={locked}
                  />
                </div>
              </div>
            )}
          </>
        )}
        <Toggle
          label="UDP over TCP"
          hint="Tunnels UDP inside the TCP connection so a network that throttles or blocks UDP can't touch it (Shadowsocks servers only)"
          checked={!!settings.udpOverTcp}
          onChange={(v) => onUpdate({ udpOverTcp: v })}
        />
        <Toggle
          label="Encrypted SNI (ECH)"
          hint="Encrypts the server name in the TLS handshake so name-based whitelisting sees nothing. Requires an ECH-enabled server."
          checked={!!settings.ech}
          onChange={(v) => onUpdate({ ech: v })}
        />
        <Toggle
          label="TLS record fragmentation"
          hint="Splits the TLS record so single-packet inspection can't read the handshake. Lower cost than handshake fragmentation."
          checked={!!settings.tlsRecordFragment}
          onChange={(v) => onUpdate({ tlsRecordFragment: v })}
        />
      </Section>

      <Section
        title="Resilience"
        icon="bolt"
        description="Staying connected when a server or protocol gets blocked"
      >
        <Toggle
          label="Automatic failover"
          hint="Continuously probes your other saved servers and switches to a working one if the active tunnel is blocked or dies — no reconnect needed"
          checked={!!settings.autoFallback}
          onChange={(v) => onUpdate({ autoFallback: v })}
        />
        {settings.autoFallback && (
          <div className="evasion-note">
            <Icon name="info" size={12} />
            <span>
              Up to three backups are used, preferring Hysteria2, then Reality/VLESS, then
              TCP-based protocols — so if UDP is throttled the tunnel falls back on its own.
            </span>
          </div>
        )}
      </Section>
    </>
  );
}
