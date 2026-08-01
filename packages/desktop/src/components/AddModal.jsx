import React, { useEffect, useState } from 'react';
import CustomConfigForm from './CustomConfigForm.jsx';
import Icon from './Icon.jsx';

export default function AddModal({ onClose, onAddLink, onAddFile, onAddSubscription, onAddCustom, onAddWithEngine }) {
  const [tab, setTab] = useState('link');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Plug-and-play: once a plain parse fails, offer to run the pasted text
  // through an explicitly-chosen engine instead -- our own sing-box (raw
  // outbound JSON) or an installed extension -- rather than just dead-ending
  // on "unsupported format".
  const [offerEngines, setOfferEngines] = useState(false);
  const [extensions, setExtensions] = useState([]);
  const [engineBusy, setEngineBusy] = useState(false);

  useEffect(() => {
    window.soul.listExtensions?.().then(setExtensions).catch(() => setExtensions([]));
  }, []);

  async function handleSubmit() {
    if (!value.trim()) return;
    setError('');
    setOfferEngines(false);
    setLoading(true);
    try {
      if (tab === 'link') {
        await onAddLink(value.trim());
      } else {
        await onAddSubscription(value.trim());
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
      if (tab === 'link') setOfferEngines(true);
    } finally {
      setLoading(false);
    }
  }

  async function handlePickEngine(engineId) {
    if (engineBusy) return;
    setEngineBusy(true);
    setError('');
    try {
      await onAddWithEngine(value.trim(), engineId);
    } catch (err) {
      setError(err.message || 'That engine could not handle this config either');
    } finally {
      setEngineBusy(false);
    }
  }

  async function handleImportFile() {
    setError('');
    setLoading(true);
    try {
      await onAddFile();
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${tab === 'custom' ? 'wide' : ''}`}>
        <h3>Add Config</h3>
        <p className="hint">
          {tab === 'custom'
            ? 'Enter all config settings manually.'
            : 'Enter a vmess://, vless://, trojan://, ss://, hysteria2://, npvt-ssh://, or tg://proxy link, a .fist bundle, a pasted WireGuard config or SSH JSON, or a subscription address.'}
        </p>

        <div className="tabs">
          <button className={`tab ${tab === 'link' ? 'active' : ''}`} onClick={() => setTab('link')}>
            Single Link
          </button>
          <button className={`tab ${tab === 'sub' ? 'active' : ''}`} onClick={() => setTab('sub')}>
            Subscription
          </button>
          <button className={`tab ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>
            Custom
          </button>
        </div>

        {tab === 'custom' ? (
          <CustomConfigForm onSubmit={onAddCustom} onCancel={onClose} />
        ) : (
          <>
            {tab === 'link' ? (
              <textarea
                className="mono"
                placeholder="vmess://... or paste a WireGuard [Interface] config, or a .fist bundle"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            ) : (
              <input
                className="mono"
                placeholder="https://example.com/sub"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            )}

            {tab === 'link' && !offerEngines && (
              <p className="add-engine-note">
                Recognized formats run through FIST's built-in sing-box engine automatically.
                Anything else offers a choice of engine (raw sing-box outbound or an installed
                extension — see the Engines tab) once you hit Add.
              </p>
            )}

            {error && <div className="error-msg">{error}</div>}

            {tab === 'link' && offerEngines && (
              <div className="engine-picker">
                <p className="hint">
                  Not a format FIST recognizes. Pick an engine to run it instead:
                </p>
                <div className="engine-picker-list">
                  <button
                    className="engine-option"
                    disabled={engineBusy}
                    onClick={() => handlePickEngine('sing-box')}
                  >
                    <Icon name="code" size={15} />
                    <span>
                      <span className="engine-option-name">Raw sing-box outbound (JSON)</span>
                      <span className="engine-option-hint">Paste sing-box's own outbound JSON shape (socks, tuic, naive, …) and run it as-is</span>
                    </span>
                  </button>
                  {extensions.map((ext) => (
                    <button
                      key={ext.id}
                      className="engine-option"
                      disabled={engineBusy}
                      onClick={() => handlePickEngine(ext.id)}
                    >
                      <Icon name="extension" size={15} />
                      <span>
                        <span className="engine-option-name">{ext.name}</span>
                        {ext.description && <span className="engine-option-hint">{ext.description}</span>}
                      </span>
                    </button>
                  ))}
                  {extensions.length === 0 && (
                    <p className="hint">
                      No extensions installed yet. Add one from the Engines tab.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="row">
              <button className="btn" onClick={onClose}>Cancel</button>
              {tab === 'link' && (
                <button className="btn" onClick={handleImportFile} disabled={loading}>
                  Import File…
                </button>
              )}
              <button className="btn primary" onClick={handleSubmit} disabled={loading || !value.trim()}>
                {loading ? 'Adding…' : 'Add'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
