import React, { useState } from 'react';
import CustomConfigForm from './CustomConfigForm.jsx';

export default function AddModal({ onClose, onAddLink, onAddSubscription, onAddCustom }) {
  const [tab, setTab] = useState('link');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!value.trim()) return;
    setError('');
    setLoading(true);
    try {
      if (tab === 'link') {
        await onAddLink(value.trim());
      } else {
        await onAddSubscription(value.trim());
      }
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
            : 'Enter a vmess://, vless://, trojan://, ss://, hysteria2://, or tg://proxy link, or a subscription address.'}
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
                placeholder="vmess://..."
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

            {error && <div className="error-msg">{error}</div>}

            <div className="row">
              <button className="btn" onClick={onClose}>Cancel</button>
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
