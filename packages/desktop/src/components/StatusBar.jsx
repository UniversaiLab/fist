import React from 'react';
import Icon from './Icon.jsx';
import CoreLogic from '@soul-connection/core-logic';
const { formatBytes, formatSpeed } = CoreLogic;

const SHORT_STATUS = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnecting: 'Disconnecting…',
};

function StatusBar({ connectionState, activeProfile, traffic, notice }) {
  const connected = connectionState === 'connected';

  return (
    <footer className={`status-rail ${connected ? 'connected' : ''}`}>
      <div className="rail-seg">
        <span className="rail-label">Status</span>
        <span className="rail-value">
          <span className={`status-dot ${connectionState}`} />
          {SHORT_STATUS[connectionState]}
        </span>
      </div>

      <div className="rail-seg grow">
        <span className="rail-label">Server</span>
        <span className="rail-value" title={activeProfile ? `${activeProfile.address}:${activeProfile.port}` : undefined}>
          {activeProfile ? (activeProfile.name || activeProfile.address) : '—'}
        </span>
      </div>

      <div className="rail-seg">
        <span className="rail-label">Downlink</span>
        <span className="rail-value mono">
          {connected && traffic ? (
            <span className="speed-down">
              <Icon name="arrowDown" size={11} />
              {formatSpeed(traffic.downlinkSpeed)}
            </span>
          ) : '—'}
        </span>
      </div>

      <div className="rail-seg">
        <span className="rail-label">Uplink</span>
        <span className="rail-value mono">
          {connected && traffic ? (
            <span className="speed-up">
              <Icon name="arrowUp" size={11} />
              {formatSpeed(traffic.uplinkSpeed)}
            </span>
          ) : '—'}
        </span>
      </div>

      <div className="rail-seg optional">
        <span className="rail-label">Session Usage</span>
        <span className="rail-value mono">
          {connected && traffic ? formatBytes(traffic.sessionTotal) : '—'}
        </span>
      </div>

      {notice && (
        <div className={`rail-notice ${notice.type === 'error' ? 'error' : ''}`} role="status">
          <Icon name="info" size={14} />
          {notice.msg}
        </div>
      )}
    </footer>
  );
}

// `activeProfile` is usually unchanged on any given ping-all tick, so
// memoizing skips a re-render of this whole footer for every other tick.
export default React.memo(StatusBar);
