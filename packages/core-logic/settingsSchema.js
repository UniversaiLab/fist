'use strict';
// Shared shape for the app's persisted settings object -- desktop's main.cjs
// uses this as JsonStore's defaults; a future mobile client can reuse the
// same shape for whichever fields apply there (ports/host/kill-switch don't,
// system-proxy-adjacent ones do).

const DEFAULT_SETTINGS = {
  launchOnStartup: false,
  runLocalProxyOnStartup: false, // replaces the old autoConnect (migrated in getSettings())
  startMinimized: false,
  restorePreviousSession: false, // renderer-owned UI state; main just persists/exposes it
  minimizeToTray: true,
  autoReconnect: true,
  killSwitchEnabled: false,
  subAutoUpdateInterval: 0, // ms; 0 = off
  singboxLogLevel: 'warn',
  socksPort: 10808, // preferred; auto-bumped to the next free port if taken
  httpPort: 10809,
  socksHost: '127.0.0.1',
  socksUsername: '',
  socksPassword: '',
  httpHost: '127.0.0.1',
  httpUsername: '',
  httpPassword: '',
  customBypass: '', // extra semicolon-separated hosts/patterns added to the system-proxy bypass list
};

module.exports = { DEFAULT_SETTINGS };
