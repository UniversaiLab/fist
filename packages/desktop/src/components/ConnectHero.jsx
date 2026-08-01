import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MapBackground from './MapBackground.jsx';
import VaporLog from './VaporLog.jsx';
import Icon from './Icon.jsx';

const LABELS = {
  disconnected: 'Tap to connect',
  connecting: '',
  connected: 'Disconnect',
  disconnecting: '',
};

function ConnectHero({ connectionState, connectionMode, activeProfile, onToggle, onSetMode }) {
  const busy = connectionState === 'connecting' || connectionState === 'disconnecting';
  const modeLocked = connectionState !== 'disconnected';

  return (
    <section className={`stage ${connectionState}`}>
      <MapBackground connectionState={connectionState} activeProfile={activeProfile} />
      <VaporLog active={connectionState === 'connected'} />

      <div className={`ring-wrap ${connectionState}`}>
        <div className="ring-halo" aria-hidden="true" />
        <motion.button
          className="connect-btn"
          onClick={onToggle}
          disabled={busy}
          whileHover={busy ? {} : { scale: 1.04 }}
          whileTap={busy ? {} : { scale: 0.95 }}
          animate={busy ? { scale: [1, 0.94, 1] } : { scale: 1 }}
          transition={busy
            ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }
            : { type: 'spring', stiffness: 320, damping: 22 }}
        >
          <Icon name="power" size={56} strokeWidth={1.6} className="connect-icon" />
          <AnimatePresence mode="wait">
            {LABELS[connectionState] && (
              <motion.span
                key={connectionState}
                className="label"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {LABELS[connectionState]}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
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
