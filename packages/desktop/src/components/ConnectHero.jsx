import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STATUS_TEXT = {
  disconnected: 'Not connected',
  connecting: 'Establishing tunnel…',
  connected: 'Connected',
  disconnecting: 'Disconnecting…',
};

const LABELS = {
  disconnected: 'Tap to connect',
  connecting: '',
  connected: 'Disconnect',
  disconnecting: '',
};

const PULSE_DOT_COUNT = 18;

function ConnectHero({ connectionState, connectionMode, activeProfile, onToggle, onSetMode }) {
  const busy = connectionState === 'connecting' || connectionState === 'disconnecting';
  const modeLocked = connectionState !== 'disconnected';

  // Scattered once per mount -- while busy, these randomly pulse green across
  // the dotted backdrop instead of showing a spinner/label on the logo itself.
  const pulseDots = useMemo(() => Array.from({ length: PULSE_DOT_COUNT }, () => ({
    top: `${5 + Math.random() * 90}%`,
    left: `${5 + Math.random() * 90}%`,
    delay: Math.random() * 2.2,
    duration: 1.1 + Math.random() * 1.3,
  })), []);

  return (
    <section className={`stage ${connectionState}`}>
      <div className="stage-glow" aria-hidden="true" />
      <div className="stage-dots" aria-hidden="true" />
      <div className="stage-pulse-dots" aria-hidden="true">
        {busy && pulseDots.map((d, i) => (
          <span
            key={i}
            className="pulse-dot"
            style={{
              top: d.top,
              left: d.left,
              animationDelay: `${d.delay}s`,
              animationDuration: `${d.duration}s`,
            }}
          />
        ))}
      </div>

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
          <img className="fist-mark" src="./logo.png" alt="" />
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
