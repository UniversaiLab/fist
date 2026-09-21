import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Section, Toggle, TextField, PasswordField, PortField, BypassField, isValidHost } from './settingsPrimitives.jsx';
import { ConfirmModal } from './ManageModals.jsx';

const PROTO_DEFAULTS = {
  socks: { host: '127.0.0.1', port: 10808, username: '', password: '' },
  http: { host: '127.0.0.1', port: 10809, username: '', password: '' },
};

const PROTO_LABEL = { socks: 'SOCKS5', http: 'HTTP' };

const hostValidate = (v) => (isValidHost(v) ? null : 'Not a valid IP address or domain');

function TestResult({ state }) {
  if (!state || state.status === 'idle') return null;
  if (state.status === 'testing') {
    return <span className="net-test-result testing"><span className="spin" aria-hidden="true" /> Testing…</span>;
  }
  if (state.status === 'ok') {
    return <span className="net-test-result ok"><Icon name="check" size={12} /> Connected{state.ms != null ? ` — ${state.ms}ms` : ''}</span>;
  }
  return <span className="net-test-result fail"><Icon name="info" size={12} /> {state.message || 'Failed'}</span>;
}

function ProxyLogFeed({ logs }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs.length]);
  if (!logs.length) {
    return <div className="net-log-empty">No events logged yet — once you connect to a server, live proxy logs will show up here.</div>;
  }
  return (
    <div className="feed net-log-feed" ref={ref}>
      {logs.slice(-80).map((l, i) => (
        <div key={`${l.t}-${i}`} className="feed-line">
          <span className="feed-dot" aria-hidden="true" />
          <span className="feed-msg mono">{l.text}</span>
          <span className="feed-t mono">{new Date(l.t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      ))}
    </div>
  );
}

export default function NetworkSettings({
  settings, connectionState, systemProxyEnabled, killSwitchBlocking,
  onUpdate, onUpdateChecked, onSystemProxyEnable, onSystemProxyDisable, onOpenProxyFolder, onResetNetworkDefaults,
}) {
  const [proto, setProto] = useState('socks');
  const [testState, setTestState] = useState({ socks: { status: 'idle' }, http: { status: 'idle' } });
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const portsLocked = connectionState !== 'disconnected';
  const localProxyRunning = connectionState === 'connected';

  useEffect(() => {
    let cancelled = false;
    window.soul.getRecentProxyLogs?.().then((initial) => { if (!cancelled) setLogs(initial || []); }).catch(() => {});
    const off = window.soul.onProxyLog?.((entry) => {
      setLogs((prev) => [...prev, entry].slice(-300));
    });
    return () => { cancelled = true; off && off(); };
  }, []);

  async function handleTest(p) {
    setTestState((s) => ({ ...s, [p]: { status: 'testing' } }));
    try {
      const res = await window.soul.testProxyConnection(p);
      setTestState((s) => ({ ...s, [p]: { status: res.ok ? 'ok' : 'fail', message: res.message, ms: res.ms } }));
    } catch (err) {
      setTestState((s) => ({ ...s, [p]: { status: 'fail', message: err.message } }));
    } finally {
      setTimeout(() => setTestState((s) => ({ ...s, [p]: { status: 'idle' } })), 3000);
    }
  }

  async function handleResetProto(p) {
    const d = PROTO_DEFAULTS[p];
    const prefix = p === 'socks' ? 'socks' : 'http';
    await onUpdateChecked({
      [`${prefix}Host`]: d.host,
      [`${prefix}Port`]: d.port,
      [`${prefix}Username`]: d.username,
      [`${prefix}Password`]: d.password,
    });
  }

  async function handleSystemProxyEnable() {
    setBusy(true);
    try { await onSystemProxyEnable(); } finally { setBusy(false); }
  }
  async function handleSystemProxyDisable() {
    setBusy(true);
    try { await onSystemProxyDisable(); } finally { setBusy(false); }
  }

  const prefix = proto === 'socks' ? 'socks' : 'http';

  return (
    <>
      <Section
        title="Kill Switch"
        icon="shield"
        description="Fully prevent traffic leaks when the VPN disconnects"
      >
        <Toggle
          label="Kill Switch"
          hint={killSwitchBlocking
            ? 'Active — all internet traffic is currently blocked because the tunnel is not connected'
            : 'If the connection drops unexpectedly, the config changes, or the tunnel degrades in any way, all of the system’s internet traffic is blocked so nothing leaks outside the tunnel; turning it on requires administrator/root access.'}
          checked={!!settings.killSwitchEnabled}
          onChange={(v) => onUpdate({ killSwitchEnabled: v })}
        />
        {killSwitchBlocking && (
          <div className="setting-row">
            <div className="setting-text">
              <span className="setting-label killswitch-active-label">
                <span className="status-dot blocking" />
                Blocking traffic
              </span>
              <span className="setting-hint">To restore internet immediately, turn off Kill Switch or reconnect to a server.</span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Network Status" icon="signal" description="Local proxy and system proxy">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label net-status-label">
              <span className={`status-dot ${localProxyRunning ? 'connected' : ''}`} />
              Local proxy service
            </span>
            <span className="setting-hint">{localProxyRunning ? 'Running' : 'Stopped — connect to a server to start it'}</span>
          </div>
        </div>
      </Section>

      <Section title="Local Proxy — Manual Setup" icon="wifi" description="Address, port, and optional authentication for SOCKS5 and HTTP">
        <div className="tabs net-proto-tabs">
          <button className={`tab ${proto === 'socks' ? 'active' : ''}`} onClick={() => setProto('socks')}>SOCKS5</button>
          <button className={`tab ${proto === 'http' ? 'active' : ''}`} onClick={() => setProto('http')}>HTTP</button>
        </div>

        <TextField
          label="Host/IP address"
          value={settings[`${prefix}Host`]}
          disabled={portsLocked}
          placeholder="127.0.0.1"
          hint="Can be an IP or a domain; 0.0.0.0 makes it reachable from the local network too"
          validate={hostValidate}
          onCommit={(v) => onUpdateChecked({ [`${prefix}Host`]: v })}
        />
        <PortField
          label={`${PROTO_LABEL[proto]} port`}
          value={settings[`${prefix}Port`]}
          disabled={portsLocked}
          onCommit={(v) => onUpdateChecked({ [`${prefix}Port`]: v })}
        />
        <TextField
          label="Username (optional)"
          value={settings[`${prefix}Username`]}
          disabled={portsLocked}
          placeholder="—"
          onCommit={(v) => onUpdateChecked({ [`${prefix}Username`]: v })}
        />
        <PasswordField
          label="Password (optional)"
          value={settings[`${prefix}Password`]}
          disabled={portsLocked}
          onCommit={(v) => onUpdateChecked({ [`${prefix}Password`]: v })}
        />
        {portsLocked && (
          <p className="setting-hint" style={{ marginTop: -4, marginBottom: 10 }}>
            Disconnect first to change these settings.
          </p>
        )}

        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Test connection</span>
            <TestResult state={testState[proto]} />
          </div>
          <div className="net-btn-row">
            <button className="btn icon-inline-btn" disabled={!localProxyRunning || testState[proto].status === 'testing'} onClick={() => handleTest(proto)}>
              <Icon name="target" size={13} /> Test Connection
            </button>
            <button className="btn icon-inline-btn" onClick={() => handleResetProto(proto)} disabled={portsLocked}>
              <Icon name="refresh" size={13} /> Reset This Protocol
            </button>
          </div>
        </div>
      </Section>

      <Section title="Bypass Routes" icon="filter" description="Addresses that always open directly, without the proxy">
        <BypassField value={settings.customBypass} onCommit={(v) => onUpdate({ customBypass: v })} />
      </Section>

      <Section title="Live Proxy Log" icon="history" description="Recent local proxy events">
        <ProxyLogFeed logs={logs} />
      </Section>

      <Section title="Advanced" icon="sliders" description="File folder and full reset">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Proxy folder</span>
            <span className="setting-hint">Active config and raw sing-box logs</span>
          </div>
          <button className="btn icon-inline-btn" onClick={onOpenProxyFolder}>
            <Icon name="folder" size={14} />
            Open
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Reset all network settings</span>
            <span className="setting-hint error">Host/port/authentication for both protocols and the bypass list revert to defaults</span>
          </div>
          <button className="btn icon-inline-btn" disabled={portsLocked} onClick={() => setConfirmResetAll(true)}>
            <Icon name="trash" size={14} />
            Reset All
          </button>
        </div>
      </Section>

      {confirmResetAll && (
        <ConfirmModal
          title="Reset Network Settings"
          message="All manual SOCKS5 and HTTP settings (address, port, authentication) and the bypass list will revert to their defaults. Continue?"
          confirmLabel="Reset"
          onClose={() => setConfirmResetAll(false)}
          onConfirm={onResetNetworkDefaults}
        />
      )}
    </>
  );
}
