import React from 'react';
import Icon from './Icon.jsx';

// Full-height slide-in that covers the compact window, with a narrow icon
// rail down the left to switch between sections. At 380px there's no room for
// a persistent sidebar, so the secondary surfaces (settings, marketplace,
// engines, wallet) live here and the connect panel stays uncluttered.

const SECTIONS = [
  { id: 'settings', icon: 'settings', label: 'Settings' },
  { id: 'network', icon: 'sliders', label: 'Network' },
  { id: 'marketplace', icon: 'store', label: 'Marketplace' },
  { id: 'wallet', icon: 'wallet', label: 'Wallet' },
  { id: 'engines', icon: 'code', label: 'Engines' },
];

export default function SettingsDrawer({ section, onSection, onClose, title, children }) {
  return (
    <div className="dw" role="dialog" aria-label={title}>
      <nav className="dw-rail">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`dw-rail-btn ${section === s.id ? 'active' : ''}`}
            onClick={() => onSection(s.id)}
            title={s.label}
            aria-label={s.label}
            aria-current={section === s.id ? 'page' : undefined}
          >
            <Icon name={s.icon} size={17} />
          </button>
        ))}
        <div className="dw-rail-spacer" />
        <button className="dw-rail-btn close" onClick={onClose} title="Close" aria-label="Close">
          <Icon name="close" size={17} />
        </button>
      </nav>

      <div className="dw-pane">
        <header className="dw-head">
          <span className="dw-title">{title}</span>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </header>
        <div className="dw-body">{children}</div>
      </div>
    </div>
  );
}

export { SECTIONS };
