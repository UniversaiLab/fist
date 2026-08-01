import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Section } from './settingsPrimitives.jsx';

const BUILTIN_PROTOCOLS = [
  'VLESS', 'VMess', 'Trojan', 'Shadowsocks', 'Hysteria2', 'WireGuard', 'SSH',
];

// Top-level registry of every engine that can run a config: our own built-in
// sing-box (always present, handles every native protocol plus raw outbound
// JSON passthrough for anything sing-box supports that we haven't built a
// parser for) and any installed extensions (their own OS process, chosen
// explicitly per-config in AddModal when a paste doesn't parse natively).
export default function Engines({ onToast, onChanged }) {
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await window.soul.listExtensions();
      setExtensions(list || []);
    } catch (err) {
      onToast?.(err.message || 'Failed to load engines', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleInstall() {
    setInstalling(true);
    try {
      const res = await window.soul.installExtension();
      if (!res.canceled) {
        await refresh();
        onChanged?.();
        onToast?.(`"${res.extension.name}" installed`);
      }
    } catch (err) {
      onToast?.(err.message || 'Failed to install engine', 'error');
    } finally {
      setInstalling(false);
    }
  }

  async function handleRemove(ext) {
    try {
      const list = await window.soul.removeExtension(ext.id);
      setExtensions(list || []);
      onChanged?.();
      onToast?.(`"${ext.name}" removed`);
    } catch (err) {
      onToast?.(err.message || 'Failed to remove engine', 'error');
    }
  }

  return (
    <div className="engines">
      <Section
        title="What's an engine?"
        icon="code"
        description="Whatever actually connects and routes traffic for a config"
      >
        <p className="engines-blurb">
          Every config runs through an engine. Standard protocols always run through
          FIST's built-in sing-box engine below. For anything FIST doesn't recognize,
          you choose an engine yourself when adding it — either a raw sing-box outbound
          (paste sing-box's own JSON shape) or an installed extension, which runs as its
          own program on your machine and can take full control of connecting and
          routing for that config, independent of sing-box.
        </p>
      </Section>

      <Section title="Built-in" icon="shield" description="Always available, cannot be removed">
        <div className="engine-card">
          <div className="engine-card-head">
            <span className="engine-card-icon builtin"><Icon name="shield" size={18} /></span>
            <div className="engine-card-heading">
              <div className="engine-card-name">sing-box</div>
              <div className="engine-card-sub">FIST's default connection core</div>
            </div>
            <span className="engine-badge builtin">BUILT-IN</span>
          </div>
          <p className="engine-card-desc">
            Natively handles every protocol FIST supports directly, plus a raw outbound
            JSON passthrough for anything else sing-box itself supports (SOCKS, TUIC,
            Naive, ShadowTLS, AnyTLS, …) that FIST hasn't built a dedicated parser for.
          </p>
          <div className="engine-proto-list">
            {BUILTIN_PROTOCOLS.map((p) => <span key={p} className="engine-proto-chip">{p}</span>)}
            <span className="engine-proto-chip raw">RAW JSON</span>
          </div>
        </div>
      </Section>

      <Section
        title="Installed extensions"
        icon="extension"
        description="Local plug-and-play engines for configs sing-box can't handle"
      >
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-hint">
              Each extension runs as its own program on your machine — FIST isolates it
              into its own process, but does not sandbox what its code does. Only install
              extensions you trust.
            </span>
          </div>
          <button className="btn icon-inline-btn" onClick={handleInstall} disabled={installing}>
            <Icon name="upload" size={14} />
            {installing ? 'Installing…' : 'Install Extension…'}
          </button>
        </div>

        {!loading && extensions.length === 0 && (
          <div className="engines-empty">
            <Icon name="extension" size={26} strokeWidth={1.6} />
            <p>No extensions installed yet. When a config can't be parsed, FIST will offer to run it through one you install here.</p>
          </div>
        )}

        {extensions.map((ext) => (
          <div className="engine-card" key={ext.id}>
            <div className="engine-card-head">
              <span className="engine-card-icon"><Icon name="extension" size={18} /></span>
              <div className="engine-card-heading">
                <div className="engine-card-name">{ext.name} <span className="mono engine-card-version">v{ext.version}</span></div>
                <div className="engine-card-sub mono">{ext.id}</div>
              </div>
              <button className="icon-btn" title="Remove engine" onClick={() => handleRemove(ext)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
            {ext.description && <p className="engine-card-desc">{ext.description}</p>}
          </div>
        ))}
      </Section>
    </div>
  );
}
