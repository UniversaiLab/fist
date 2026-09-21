import React from 'react';
import Icon from './Icon.jsx';

// The top half of the compact window: the power control, the live status
// strip, and the name of wherever we're pointed. This replaces the old
// full-width ConnectHero -- same state vocabulary (`connectionState`), but
// laid out for a ~380px panel instead of a square desktop pane.

const STATE_LABEL = {
  disconnected: 'OFF',
  connecting: 'CONNECTING',
  connected: 'ON',
  disconnecting: 'STOPPING',
};

// The header's accent colour tracks connection state, which is the single
// strongest visual signal in the whole window.
function stateTone(connectionState) {
  if (connectionState === 'connected') return 'on';
  if (connectionState === 'connecting' || connectionState === 'disconnecting') return 'busy';
  return 'off';
}

export default function CompactConnect({
  connectionState, connectionMode, activeProfile, settings,
  publicIp, onToggle, onOpenLocations,
  onToggleKillSwitch,
}) {
  const tone = stateTone(connectionState);
  const busy = connectionState === 'connecting' || connectionState === 'disconnecting';

  // Split the profile name the way the reference clients do: a big primary
  // line plus a quieter qualifier, so a long "Boston MIT"-shaped name stays
  // readable at this width instead of wrapping into mush. The empty state is
  // deliberately not split -- "No Server" must not render as "No / SERVER".
  const rawName = activeProfile ? (activeProfile.name || activeProfile.address) : '';
  const [head, ...restParts] = rawName.split(/\s+/);
  const rest = restParts.join(' ');

  const port = connectionMode === 'tun'
    ? 'TUN'
    : (settings?.socksPort ? String(settings.socksPort) : '—');

  return (
    <section className={`ck ck-${tone}`}>
      <div className="ck-statusline">
        <span className={`ck-state ck-state-${tone}`}>{STATE_LABEL[connectionState] || 'OFF'}</span>
        <span className="ck-chip static" title="All traffic is routed through the tunnel at the OS level">
          Full Tunnel
        </span>
        <span className="ck-port mono">{port}</span>

        <button
          className={`ck-power ck-power-${tone} ${busy ? 'busy' : ''}`}
          onClick={onToggle}
          disabled={busy || !activeProfile}
          title={!activeProfile ? 'Pick a server first' : connectionState === 'connected' ? 'Disconnect' : 'Connect'}
          aria-label={connectionState === 'connected' ? 'Disconnect' : 'Connect'}
        >
          <span className="ck-power-ring" aria-hidden="true" />
          <Icon name="power" size={22} />
        </button>
      </div>

      <button className="ck-location" onClick={onOpenLocations} title="Choose a server">
        {activeProfile ? (
          <>
            <span className="ck-loc-name">{head}</span>
            {rest && <span className="ck-loc-sub">{rest}</span>}
          </>
        ) : (
          <>
            <span className="ck-loc-name dim">No Server</span>
            <span className="ck-loc-sub">Choose a server to begin</span>
          </>
        )}
      </button>

      <div className="ck-meta">
        <button
          className="ck-meta-row ck-meta-action"
          onClick={onToggleKillSwitch}
          title="Block all traffic if the tunnel drops"
        >
          <span className="ck-meta-label">
            <Icon name="shield" size={12} />
            Kill Switch
          </span>
          <span className={`ck-meta-val ${settings?.killSwitchEnabled ? 'on' : ''}`}>
            {settings?.killSwitchEnabled ? 'Armed' : 'Off'}
          </span>
        </button>

        {publicIp && (
          <div className="ck-meta-row">
            <span className="ck-meta-label">
              <Icon name="signal" size={12} />
              IP
            </span>
            <span className="ck-meta-val mono">{publicIp}</span>
          </div>
        )}
      </div>

    </section>
  );
}
