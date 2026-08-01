import React, { useState } from 'react';
import Icon from './Icon.jsx';

const PROTOCOLS = [
  { value: 'vless', label: 'VLESS' },
  { value: 'vmess', label: 'VMess' },
  { value: 'trojan', label: 'Trojan' },
  { value: 'shadowsocks', label: 'Shadowsocks' },
  { value: 'ssh', label: 'SSH' },
];

const NETWORKS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'ws', label: 'WebSocket' },
  { value: 'grpc', label: 'gRPC' },
  { value: 'h2', label: 'HTTP/2' },
  { value: 'kcp', label: 'mKCP' },
];

const SECURITIES = [
  { value: 'none', label: 'No Security' },
  { value: 'tls', label: 'TLS' },
  { value: 'reality', label: 'Reality' },
];

const SS_METHODS = [
  'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
  'chacha20-ietf-poly1305', 'chacha20-poly1305', 'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'none', 'plain',
];

const TCP_HEADERS = [
  { value: 'none', label: 'No Header' },
  { value: 'http', label: 'HTTP Obfuscation' },
];

const KCP_HEADERS = [
  { value: 'none', label: 'No Header' },
  { value: 'srtp', label: 'srtp' },
  { value: 'utp', label: 'utp' },
  { value: 'wechat-video', label: 'wechat-video' },
  { value: 'dtls', label: 'dtls' },
  { value: 'wireguard', label: 'wireguard' },
];

const VLESS_FLOWS = [
  { value: '', label: 'No Flow' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
];

const DEFAULT_FIELDS = {
  protocol: 'vless',
  name: '',
  address: '',
  port: 443,
  uuid: '',
  password: '',
  method: 'chacha20-ietf-poly1305',
  alterId: 0,
  scy: 'auto',
  network: 'tcp',
  security: 'tls',
  sni: '',
  alpn: '',
  fingerprint: '',
  allowInsecure: false,
  host: '',
  path: '',
  headerType: 'none',
  serviceName: '',
  flow: '',
  encryption: 'none',
  publicKey: '',
  shortId: '',
  spiderX: '',
  username: '',
  privateKey: '',
  jumps: [],
};

// One jump/bastion host in an SSH chain: its own address/port/username and
// either a password or a private key -- mirrors `ssh -J hop1,hop2,...`.
function emptyJump() {
  return { address: '', port: 22, username: '', password: '', privateKey: '' };
}

function Field({ label, children, hint, span }) {
  return (
    <div className={`custom-field ${span ? 'span-2' : ''}`}>
      <label className="field-label">{label}</label>
      {children}
      {hint && <span className="setting-hint custom-field-hint">{hint}</span>}
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div className="custom-form-group">
      <h4 className="custom-form-group-title">{title}</h4>
      <div className="custom-form-grid">{children}</div>
    </div>
  );
}

export default function CustomConfigForm({ onSubmit, onCancel }) {
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (patch) => setFields((f) => ({ ...f, ...patch }));

  const { protocol, network, security } = fields;
  const isVmessOrVless = protocol === 'vmess' || protocol === 'vless';
  const isTrojanOrSs = protocol === 'trojan' || protocol === 'shadowsocks';
  const showTls = security === 'tls';
  const showReality = security === 'reality';
  const showPathHost = network === 'ws' || network === 'h2' || (network === 'tcp' && fields.headerType === 'http');
  const showServiceName = network === 'grpc';
  const showHeaderType = network === 'tcp' || network === 'kcp';
  const securityOptions = protocol === 'vmess' ? SECURITIES.filter((s) => s.value !== 'reality') : SECURITIES;

  function validateClientSide() {
    if (!fields.address.trim()) return 'Enter the server address';
    const port = Number(fields.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be between 1 and 65535';
    if (isVmessOrVless) {
      const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (!uuidRe.test(fields.uuid.trim())) return 'Invalid UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)';
    }
    if (isTrojanOrSs && !fields.password.trim()) return 'Enter a password';
    if (protocol === 'ssh') {
      if (!fields.username.trim()) return 'Enter a username';
      if (!fields.password.trim() && !fields.privateKey.trim()) return 'Enter a password or a private key';
      for (let i = 0; i < fields.jumps.length; i++) {
        const j = fields.jumps[i];
        if (!j.address.trim()) return `Jump host ${i + 1}: enter an address`;
        if (!j.username.trim()) return `Jump host ${i + 1}: enter a username`;
        if (!j.password.trim() && !j.privateKey.trim()) return `Jump host ${i + 1}: enter a password or a private key`;
      }
    }
    return '';
  }

  async function handleSubmit() {
    const clientError = validateClientSide();
    if (clientError) { setError(clientError); return; }
    setError('');
    setLoading(true);
    try {
      await onSubmit({ ...fields, port: Number(fields.port) });
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="custom-config-form">
      <Group title="Config Type">
        <Field label="Protocol">
          <select className="setting-select" value={protocol} onChange={(e) => set({ protocol: e.target.value, security: e.target.value === 'vmess' && security === 'reality' ? 'tls' : security })}>
            {PROTOCOLS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Name (optional)">
          <input className="mono" value={fields.name} placeholder="A custom name for this server" onChange={(e) => set({ name: e.target.value })} />
        </Field>
      </Group>

      <Group title="Server Address">
        <Field label="Host / IP">
          <input className="mono" value={fields.address} placeholder="example.com" onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Port">
          <input className="mono" type="number" min={1} max={65535} value={fields.port} onChange={(e) => set({ port: e.target.value })} />
        </Field>
      </Group>

      <Group title="Authentication">
        {isVmessOrVless && (
          <Field label="UUID" span>
            <input className="mono" value={fields.uuid} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(e) => set({ uuid: e.target.value })} />
          </Field>
        )}
        {protocol === 'vmess' && (
          <>
            <Field label="Alter ID">
              <input className="mono" type="number" min={0} value={fields.alterId} onChange={(e) => set({ alterId: e.target.value })} />
            </Field>
            <Field label="Security (encryption)">
              <select className="setting-select" value={fields.scy} onChange={(e) => set({ scy: e.target.value })}>
                {['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </>
        )}
        {protocol === 'vless' && (
          <>
            <Field label="Flow">
              <select className="setting-select" value={fields.flow} onChange={(e) => set({ flow: e.target.value })}>
                {VLESS_FLOWS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Encryption">
              <input className="mono" value={fields.encryption} placeholder="none" onChange={(e) => set({ encryption: e.target.value })} />
            </Field>
          </>
        )}
        {protocol === 'trojan' && (
          <Field label="Password" span>
            <input className="mono" type="text" value={fields.password} onChange={(e) => set({ password: e.target.value })} />
          </Field>
        )}
        {protocol === 'shadowsocks' && (
          <>
            <Field label="Encryption Method">
              <select className="setting-select" value={fields.method} onChange={(e) => set({ method: e.target.value })}>
                {SS_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Password">
              <input className="mono" type="text" value={fields.password} onChange={(e) => set({ password: e.target.value })} />
            </Field>
          </>
        )}
        {protocol === 'ssh' && (
          <>
            <Field label="Username">
              <input className="mono" value={fields.username} placeholder="root" onChange={(e) => set({ username: e.target.value })} />
            </Field>
            <Field label="Password">
              <input className="mono" type="text" value={fields.password} placeholder="leave blank if using a private key" onChange={(e) => set({ password: e.target.value })} />
            </Field>
            <Field label="Private Key (optional, PEM)" span hint="Used instead of the password when set">
              <textarea className="mono" rows={3} value={fields.privateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" onChange={(e) => set({ privateKey: e.target.value })} />
            </Field>
          </>
        )}
      </Group>

      {protocol === 'ssh' && (
        <Group title="Jump / Bastion Hosts (optional)">
          <Field label="" span hint="Chain through one or more hosts first, mirroring `ssh -J hop1,hop2,... finalHost` -- entry hop first.">
            <div className="jump-list">
              {fields.jumps.map((jump, i) => (
                <div className="jump-row" key={i}>
                  <div className="jump-row-head">
                    <span className="jump-row-title">Hop {i + 1}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Remove hop"
                      onClick={() => set({ jumps: fields.jumps.filter((_, j) => j !== i) })}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                  <div className="jump-row-grid">
                    <input
                      className="mono" placeholder="Host / IP" value={jump.address}
                      onChange={(e) => set({ jumps: fields.jumps.map((j, k) => (k === i ? { ...j, address: e.target.value } : j)) })}
                    />
                    <input
                      className="mono" type="number" min={1} max={65535} placeholder="Port" value={jump.port}
                      onChange={(e) => set({ jumps: fields.jumps.map((j, k) => (k === i ? { ...j, port: e.target.value } : j)) })}
                    />
                    <input
                      className="mono" placeholder="Username" value={jump.username}
                      onChange={(e) => set({ jumps: fields.jumps.map((j, k) => (k === i ? { ...j, username: e.target.value } : j)) })}
                    />
                    <input
                      className="mono" placeholder="Password" value={jump.password}
                      onChange={(e) => set({ jumps: fields.jumps.map((j, k) => (k === i ? { ...j, password: e.target.value } : j)) })}
                    />
                  </div>
                  <textarea
                    className="mono jump-row-key" rows={2} placeholder="Private key (optional, PEM) -- used instead of the password when set"
                    value={jump.privateKey}
                    onChange={(e) => set({ jumps: fields.jumps.map((j, k) => (k === i ? { ...j, privateKey: e.target.value } : j)) })}
                  />
                </div>
              ))}
              <button type="button" className="btn icon-inline-btn jump-add-btn" onClick={() => set({ jumps: [...fields.jumps, emptyJump()] })}>
                <Icon name="plus" size={13} />
                Add Jump Host
              </button>
            </div>
          </Field>
        </Group>
      )}

      {protocol !== 'shadowsocks' && protocol !== 'ssh' && (
        <Group title="Transport">
          <Field label="Network Type">
            <select className="setting-select" value={network} onChange={(e) => set({ network: e.target.value, headerType: 'none' })}>
              {NETWORKS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
          </Field>
          {showHeaderType && (
            <Field label="Header Type">
              <select className="setting-select" value={fields.headerType} onChange={(e) => set({ headerType: e.target.value })}>
                {(network === 'tcp' ? TCP_HEADERS : KCP_HEADERS).map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </Field>
          )}
          {showServiceName && (
            <Field label="Service Name" span>
              <input className="mono" value={fields.serviceName} onChange={(e) => set({ serviceName: e.target.value })} />
            </Field>
          )}
          {showPathHost && (
            <>
              <Field label="Path">
                <input className="mono" value={fields.path} placeholder="/" onChange={(e) => set({ path: e.target.value })} />
              </Field>
              <Field label="Host Header">
                <input className="mono" value={fields.host} placeholder="—" onChange={(e) => set({ host: e.target.value })} />
              </Field>
            </>
          )}
        </Group>
      )}

      {protocol !== 'shadowsocks' && protocol !== 'ssh' && (
        <Group title="Security">
          <Field label="Security">
            <select className="setting-select" value={security} onChange={(e) => set({ security: e.target.value })}>
              {securityOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          {(showTls || showReality) && (
            <Field label="SNI">
              <input className="mono" value={fields.sni} placeholder={fields.address} onChange={(e) => set({ sni: e.target.value })} />
            </Field>
          )}
          {showTls && (
            <>
              <Field label="ALPN">
                <input className="mono" value={fields.alpn} placeholder="h2,http/1.1" onChange={(e) => set({ alpn: e.target.value })} />
              </Field>
              <Field label="Fingerprint">
                <input className="mono" value={fields.fingerprint} placeholder="chrome" onChange={(e) => set({ fingerprint: e.target.value })} />
              </Field>
              <Field label="Allow Insecure">
                <label className="custom-checkbox-row">
                  <input type="checkbox" checked={fields.allowInsecure} onChange={(e) => set({ allowInsecure: e.target.checked })} />
                  <span>Also accept invalid certificates</span>
                </label>
              </Field>
            </>
          )}
          {showReality && (
            <>
              <Field label="Fingerprint">
                <input className="mono" value={fields.fingerprint} placeholder="chrome" onChange={(e) => set({ fingerprint: e.target.value })} />
              </Field>
              <Field label="Public Key">
                <input className="mono" value={fields.publicKey} onChange={(e) => set({ publicKey: e.target.value })} />
              </Field>
              <Field label="Short ID">
                <input className="mono" value={fields.shortId} onChange={(e) => set({ shortId: e.target.value })} />
              </Field>
              <Field label="Spider X">
                <input className="mono" value={fields.spiderX} placeholder="/" onChange={(e) => set({ spiderX: e.target.value })} />
              </Field>
            </>
          )}
        </Group>
      )}

      {error && <div className="error-msg">{error}</div>}

      <div className="row">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Adding…' : 'Add Config'}
        </button>
      </div>
    </div>
  );
}
