import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Section } from './settingsPrimitives.jsx';

// Plug-and-play plugin system: extensions are small local folders (an
// extension.json manifest + entry script) the user installs, each spawned as
// its own OS process when chosen to parse or run a config FIST doesn't know
// how to handle natively. This panel just manages the installed set --
// AddModal.jsx is where the user actually picks one for a given config.
export default function ExtensionsSettings() {
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await window.soul.listExtensions();
      setExtensions(list || []);
    } catch (err) {
      setError(err.message || 'Failed to load extensions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleInstall() {
    setInstalling(true);
    setError('');
    try {
      const res = await window.soul.installExtension();
      if (!res.canceled) await refresh();
    } catch (err) {
      setError(err.message || 'Failed to install extension');
    } finally {
      setInstalling(false);
    }
  }

  async function handleRemove(id) {
    setError('');
    try {
      const list = await window.soul.removeExtension(id);
      setExtensions(list || []);
    } catch (err) {
      setError(err.message || 'Failed to remove extension');
    }
  }

  return (
    <Section
      title="Extensions"
      icon="extension"
      description="Plug-and-play engines for configs FIST doesn't know how to handle natively"
    >
      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">Installed extensions</span>
          <span className="setting-hint">
            Each extension runs as its own program on your machine — FIST isolates it into its own process, but does not sandbox what its code does. Only install extensions you trust.
          </span>
          {error && <span className="setting-hint error">{error}</span>}
        </div>
        <button className="btn icon-inline-btn" onClick={handleInstall} disabled={installing}>
          <Icon name="upload" size={14} />
          {installing ? 'Installing…' : 'Install Extension…'}
        </button>
      </div>

      {!loading && extensions.length === 0 && (
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-hint">No extensions installed yet.</span>
          </div>
        </div>
      )}

      {extensions.map((ext) => (
        <div className="setting-row" key={ext.id}>
          <div className="setting-text">
            <span className="setting-label">{ext.name} <span className="mono setting-hint">v{ext.version}</span></span>
            {ext.description && <span className="setting-hint">{ext.description}</span>}
          </div>
          <button className="icon-btn" title="Remove extension" onClick={() => handleRemove(ext.id)}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
    </Section>
  );
}
