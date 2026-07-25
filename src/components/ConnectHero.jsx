import React from 'react';

const STATUS_TEXT = {
  disconnected: 'Not connected',
  connecting: 'Establishing tunnel…',
  connected: 'Connected',
  disconnecting: 'Disconnecting…',
};

const LABELS = {
  disconnected: 'Connect',
  connecting: 'Connecting…',
  connected: 'Disconnect',
  disconnecting: 'Disconnecting…',
};

// A small homage to the offline "T-Rex" game: idle and standing while
// disconnected, running while a tunnel is being established or torn down,
// and resting happily (color follows .connect-btn's currentColor, so it
// turns signal-teal automatically once connected -- see index.css).
function Dino({ running }) {
  return (
    <svg className="dino" viewBox="0 0 16 14" aria-hidden="true" shapeRendering="crispEdges">
      <g className="dino-body">
        <rect x="11" y="1" width="3" height="1" />
        <rect x="10" y="2" width="5" height="2" />
        <rect x="9" y="4" width="6" height="1" />
        <rect className="dino-eye" x="12" y="2" width="1" height="1" />
        <rect x="8" y="5" width="7" height="1" />
        <rect x="4" y="6" width="11" height="1" />
        <rect x="3" y="7" width="10" height="1" />
        <rect x="3" y="8" width="9" height="1" />
        <rect x="1" y="7" width="2" height="1" />
        <rect x="0" y="8" width="2" height="1" />
        <rect x="9" y="9" width="1" height="1" />
      </g>
      <g className={`dino-legs-a ${running ? 'run' : ''}`}>
        <rect x="5" y="9" width="2" height="3" />
        <rect x="10" y="9" width="2" height="3" />
        <rect x="4" y="12" width="3" height="1" />
        <rect x="9" y="12" width="3" height="1" />
      </g>
      <g className={`dino-legs-b ${running ? 'run' : ''}`}>
        <rect x="4" y="9" width="2" height="2" />
        <rect x="3" y="11" width="3" height="1" />
        <rect x="10" y="9" width="2" height="4" />
        <rect x="11" y="13" width="2" height="1" />
      </g>
    </svg>
  );
}

function ConnectHero({ connectionState, connectionMode, activeProfile, onToggle, onSetMode }) {
  const busy = connectionState === 'connecting' || connectionState === 'disconnecting';
  const modeLocked = connectionState !== 'disconnected';

  return (
    <section className={`stage ${connectionState}`}>
      <div className="aurora aurora-idle" aria-hidden="true" />
      <div className="aurora aurora-live" aria-hidden="true" />

      <div className={`ring-wrap ${connectionState}`}>
        <div className="ring-halo" aria-hidden="true" />
        <svg className="ring-svg" viewBox="0 0 200 200" aria-hidden="true">
          <circle className="ring-track" cx="100" cy="100" r="88" />
          <circle className="ring-spin" cx="100" cy="100" r="88" />
          <circle className="ring-arc" cx="100" cy="100" r="88" />
        </svg>
        <button className="connect-btn" onClick={onToggle} disabled={busy}>
          <div className="dino-scene">
            <Dino running={busy} />
            <span className="dino-ground" aria-hidden="true" />
          </div>
          <span className="label">{LABELS[connectionState]}</span>
        </button>
      </div>

      <div className="stage-status">
        <span className={`status-dot ${connectionState}`} />
        {STATUS_TEXT[connectionState]}
      </div>

      <div className="stage-server">
        {activeProfile ? (
          <>
            <span className="name">{activeProfile.name || activeProfile.address}</span>
            <span className="addr mono">{activeProfile.address}:{activeProfile.port}</span>
          </>
        ) : (
          'No server selected — pick one from the sidebar list'
        )}
      </div>

      <div className={`mode-switch ${connectionMode === 'tun' ? 'tun' : ''}`}>
        <span className="mode-thumb" aria-hidden="true" />
        <button
          className={`mode-pill ${connectionMode === 'proxy' ? 'active' : ''}`}
          disabled={modeLocked}
          onClick={() => onSetMode('proxy')}
        >
          System Proxy
        </button>
        <button
          className={`mode-pill ${connectionMode === 'tun' ? 'active' : ''}`}
          disabled={modeLocked}
          onClick={() => onSetMode('tun')}
        >
          Full Tunnel
        </button>
      </div>
      <div className="mode-hint">
        {modeLocked ? 'Disconnect first to change mode' : ''}
      </div>
    </section>
  );
}

// Doesn't depend on `pings`/`traffic` -- memoized so App's 1s traffic-poll
// re-render and ping-all bursts don't repaint this whole animated hero.
export default React.memo(ConnectHero);
