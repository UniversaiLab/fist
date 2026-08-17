import React from 'react';
import Icon from './Icon.jsx';

// Bottom half of the compact window. Collapsed it's a single bar showing what
// you'd pick next; expanded it slides up over the connect panel and hands the
// whole area to the existing ServerList (unchanged -- it already does search,
// grouping, subscriptions, and the context menu).
export default function LocationsPanel({ open, onToggle, count, children, onAdd, onOpenFinder }) {
  return (
    <section className={`lp ${open ? 'open' : ''}`}>
      <header className="lp-head">
        <button className="lp-toggle" onClick={onToggle} aria-expanded={open}>
          <span className={`lp-chev ${open ? 'up' : ''}`}>
            <Icon name="chevron" size={13} />
          </span>
          <span className="lp-title">Locations</span>
          <span className="lp-count mono">{count}</span>
        </button>
        <div className="lp-head-actions">
          <button className="icon-btn" title="Smart Server Finder (Ctrl+K)" onClick={onOpenFinder}>
            <Icon name="radar" size={14} />
          </button>
          <button className="icon-btn" title="Add config" onClick={onAdd}>
            <Icon name="plus" size={14} />
          </button>
        </div>
      </header>

      {open && <div className="lp-body">{children}</div>}
    </section>
  );
}
