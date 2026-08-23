import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Section } from './settingsPrimitives.jsx';

// Crypto payment surface. The desktop app never holds keys or signs anything:
// it asks the marketplace server to open an invoice, shows the address and
// amount to send, and polls until the chain confirms it. That keeps every
// spending secret server-side and this pane purely presentational.

const POLL_MS = 15000;

function serverBase() {
  // Same override the rest of the marketplace integration will use; falls
  // back to the documented local dev port.
  try {
    return localStorage.getItem('fist.marketplace.server') || 'http://localhost:4310';
  } catch {
    return 'http://localhost:4310';
  }
}

function authToken() {
  try {
    return localStorage.getItem('fist.marketplace.token') || '';
  } catch {
    return '';
  }
}

// Wei is an integer string with `decimals` implied places -- format it for
// display without going through a float, which would lose precision on
// realistic amounts.
function formatUnits(weiStr, decimals = 18, places = 6) {
  const wei = BigInt(weiStr || '0');
  const base = 10n ** BigInt(decimals);
  const whole = wei / base;
  const frac = (wei % base).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

const STATUS_TONE = { paid: 'good', pending: 'mid', expired: 'bad' };

export default function Wallet({ onToast }) {
  const [config, setConfig] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const cfgRes = await fetch(`${serverBase()}/api/payments/config`);
      if (!cfgRes.ok) throw new Error(`server responded ${cfgRes.status}`);
      setConfig(await cfgRes.json());

      const token = authToken();
      if (token) {
        const invRes = await fetch(`${serverBase()}/api/payments/invoices`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (invRes.ok) setInvoices((await invRes.json()).invoices || []);
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Could not reach the marketplace server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep pending invoices fresh -- confirmation depth means a payment can
  // take several minutes to finalize after the user has already sent it.
  useEffect(() => {
    if (!invoices.some((i) => i.status === 'pending')) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [invoices, load]);

  const copy = useCallback((text) => {
    navigator.clipboard?.writeText(text)
      .then(() => onToast?.('Address copied'))
      .catch(() => onToast?.('Copy failed', 'error'));
  }, [onToast]);

  if (loading) return <div className="wl-empty">Loading…</div>;

  if (error) {
    return (
      <div className="wl-empty">
        <Icon name="info" size={22} />
        <p>{error}</p>
        <p className="setting-hint">
          Payments need the marketplace server running. Start it with
          <span className="mono"> npm run marketplace:server:dev</span>.
        </p>
        <button className="btn" onClick={load}>Retry</button>
      </div>
    );
  }

  return (
    <div className="wl">
      <Section title="Payments" icon="wallet" description="How money moves through the marketplace">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Crypto settlement</span>
            <span className="setting-hint">
              {config?.cryptoEnabled
                ? `Enabled — invoices settle on-chain in ${(config.assets || []).join(', ')}`
                : 'Not configured on the server — purchases fall back to simulated payment'}
            </span>
          </div>
          <span className={`wl-badge ${config?.cryptoEnabled ? 'on' : ''}`}>
            {config?.cryptoEnabled ? 'Live' : 'Off'}
          </span>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Platform margin</span>
            <span className="setting-hint">Taken from each config sale; the rest is credited to the seller</span>
          </div>
          <span className="wl-badge mono">{((config?.platformFeeBps || 0) / 100).toFixed(1)}%</span>
        </div>
      </Section>

      <Section title="Invoices" icon="history" description="Your crypto payments and their status">
        {!authToken() && (
          <p className="setting-hint">Sign in to the marketplace to see your invoices.</p>
        )}
        {authToken() && invoices.length === 0 && (
          <p className="setting-hint">No invoices yet. Buying a config opens one here.</p>
        )}
        {invoices.map((inv) => (
          <div className="wl-inv" key={inv.id}>
            <div className="wl-inv-head">
              <span className={`wl-badge ${STATUS_TONE[inv.status] || ''}`}>{inv.status}</span>
              <span className="wl-inv-amt mono">
                {formatUnits(inv.amountWei)} {inv.asset}
              </span>
              <span className="wl-inv-usd mono">${(inv.amountCents / 100).toFixed(2)}</span>
            </div>
            <button className="wl-addr mono" onClick={() => copy(inv.address)} title="Copy address">
              {inv.address}
              <Icon name="copy" size={12} />
            </button>
            {inv.status === 'pending' && (
              <span className="setting-hint">
                Waiting for {inv.confirmationsRequired} confirmations after payment lands.
              </span>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}
