'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, Notification, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const {
  parseLink, parseMany, parseConfigText, parseRawOutbound, newId, parseSubscriptionUserinfo, buildCustomProfile,
  buildSingboxConfig, encodeFistBundle, DEFAULT_SETTINGS,
} = require('@soul-connection/core-logic');
const { SingBoxProcess } = require('./lib/singboxProcess.cjs');
const extensionHost = require('./lib/extensionHost.cjs');
const systemProxy = require('./lib/systemProxy.cjs');
const killSwitch = require('./lib/killSwitch.cjs');
const { tcpPing } = require('./lib/pingTest.cjs');
const { proxyPing } = require('./lib/proxyPing.cjs');
const serverTest = require('./lib/serverTest.cjs');
const { testLocalProxy } = require('./lib/localProxyTest.cjs');
const { fetchText } = require('./lib/fetchText.cjs');
const { JsonStore } = require('./lib/store.cjs');
const { findFreePort } = require('./lib/freePort.cjs');
const { isElevated, relaunchElevated } = require('./lib/elevation.cjs');
const { createStatsClient } = require('./lib/statsApi.cjs');
const singboxCaps = require('./lib/singboxCaps.cjs');
const { initUpdater, checkForUpdates, downloadUpdate, quitAndInstall } = require('./lib/updater.cjs');

const API_PORT = 10810;
const LATENCY_POLL_MS = 15000;
const TRAFFIC_POLL_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;

// True portable mode: electron-builder's portable Windows target sets
// PORTABLE_EXECUTABLE_DIR (the folder containing the actual .exe, as opposed
// to the temp dir it's extracted/run from) so the app can keep all of its
// data next to the exe instead of scattering it into the user's AppData --
// carry the exe + its "data" folder anywhere and it's fully self-contained,
// with no trace left on a machine after you delete that folder. Falls back
// to the normal per-user AppData path for the NSIS-installed build and for
// local development (where this env var is never set).
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data'));
}

const userDataDir = app.getPath('userData');
fs.mkdirSync(userDataDir, { recursive: true });
const store = new JsonStore(path.join(userDataDir, 'profiles.json'), {
  profiles: [],
  subscriptions: [],
  activeProfileId: null,
  settings: { ...DEFAULT_SETTINGS },
  systemProxyEnabled: false, // app-owned live state, not a user preference -- set only by systemProxy:enable/disable and the disconnect safety net
});

// sing-box ships one binary per OS -- 'sing-box.exe' on Windows, extensionless
// 'sing-box' on macOS/Linux, namespaced by platform so a dev checkout can hold
// binaries for more than one OS at once.
const SINGBOX_BIN_NAME = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const singboxBin = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', SINGBOX_BIN_NAME)
  : path.join(__dirname, '..', 'bin', process.platform, SINGBOX_BIN_NAME);
const singboxWorkDir = path.join(userDataDir, 'singbox-run');

const singbox = new SingBoxProcess(singboxBin, singboxWorkDir);

// Local proxy log panel (Network settings): keep a capped ring buffer so a
// freshly opened panel isn't empty, and forward each line live.
const MAX_PROXY_LOGS = 300;
let proxyLogRing = [];
singbox.on('log', (text) => {
  const entry = { t: Date.now(), text: text.trim() };
  proxyLogRing.push(entry);
  if (proxyLogRing.length > MAX_PROXY_LOGS) proxyLogRing.splice(0, proxyLogRing.length - MAX_PROXY_LOGS);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('proxy-log', entry);
  if (process.env.SC_DEBUG) console.log('[singbox]', entry.text);
});

// Whichever engine is actually driving the current connection -- the
// built-in sing-box singleton (reused across connections), or a freshly
// spawned ExtensionEngine (one per connection) when profile.engine names an
// installed extension. connect()/disconnect() and the reconnect logic below
// all go through this instead of the `singbox` binding directly, so a
// plugin-driven connection gets the exact same lifecycle handling.
let activeEngine = singbox;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let expectedExit = false;
let reconnectAttempts = 0;
// Kill Switch: `killSwitchBlocking` mirrors whether the outbound-block
// firewall rules are actually in place right now; `killSwitchArmed` tracks
// whether we've had at least one successful tunnel this run (or the user
// just turned the feature on while already connected) -- until armed, a
// disconnect is not "the VPN dropping", it's just "never connected yet",
// so it must not trigger a block.
let killSwitchBlocking = false;
let killSwitchArmed = false;
let latencyTimer = null;
let latencyPollInFlight = false;
let trafficTimer = null;
let trafficPollInFlight = false;
let statsClient = null;
let sessionTraffic = { uplink: 0, downlink: 0 };
let subAutoUpdateTimer = null;
let connectedAt = null;
let currentPorts = null; // { socksPort, httpPort, apiPort } of the live session

// Serializes every external trigger of connect()/disconnect() (IPC, tray,
// auto-reconnect, auto-connect-on-launch) so overlapping calls queue up
// instead of racing each other and corrupting connection state.
let opChain = Promise.resolve();
function serialize(fn) {
  const result = opChain.then(fn, fn);
  opChain = result.then(() => {}, () => {});
  return result;
}
let connectionState = 'disconnected'; // disconnected | connecting | connected | disconnecting

function getSettings() {
  const raw = store.get('settings', {});
  // One-time migration: the old autoConnect toggle became runLocalProxyOnStartup
  // (same trigger -- connect to the last active profile at launch -- but no
  // longer auto-enables system proxy as a side effect). Idempotent: once
  // migrated, 'runLocalProxyOnStartup' in raw is true and this is a no-op.
  if ('autoConnect' in raw && !('runLocalProxyOnStartup' in raw)) {
    raw.runLocalProxyOnStartup = raw.autoConnect;
    delete raw.autoConnect;
    store.set('settings', raw);
  }
  return { ...DEFAULT_SETTINGS, ...raw };
}

function updateSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  store.set('settings', merged);
  return merged;
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: APP_ICON_PATH }).show();
    }
  } catch { /* ignore */ }
}

function sendState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-changed', {
      connectionState,
      activeProfileId: store.get('activeProfileId', null),
      connectedAt,
      systemProxyEnabled: store.get('systemProxyEnabled', false),
      killSwitchBlocking,
    });
  }
  updateTray();
  updateLatencyPolling();
  updateTrafficPolling();
}

function updateTray() {
  if (!tray) return;
  const profile = findProfile(store.get('activeProfileId'));
  const label = connectionState === 'connected' ? `Connected — ${profile ? profile.name : ''}`
    : connectionState === 'connecting' ? 'Connecting…'
    : connectionState === 'disconnecting' ? 'Disconnecting…'
    : 'Disconnected — FIST';
  tray.setToolTip(label.trim());
  tray.setContextMenu(buildTrayMenu());
}

const TRAY_SERVER_LIST_LIMIT = 12;

function buildTrayMenu() {
  const connected = connectionState === 'connected';
  const busy = connectionState === 'connecting' || connectionState === 'disconnecting';
  const activeId = store.get('activeProfileId');
  const profile = findProfile(activeId);
  const mode = store.get('connectionMode', 'tun');
  const allProfiles = store.get('profiles', []);

  const serverItems = allProfiles.slice(0, TRAY_SERVER_LIST_LIMIT).map((p) => ({
    label: p.name || `${p.address}:${p.port}`,
    type: 'radio',
    checked: p.id === activeId,
    enabled: !busy,
    click: () => {
      if (p.id === activeId && connected) return;
      serialize(() => connect(p.id)).catch(() => {});
    },
  }));

  return Menu.buildFromTemplate([
    {
      label: profile ? `Server: ${profile.name}` : 'No config selected',
      enabled: false,
    },
    { label: `Mode: ${mode === 'tun' ? 'Full Tunnel' : 'System Proxy'}`, enabled: false },
    { type: 'separator' },
    {
      label: connected ? 'Disconnect' : 'Connect',
      enabled: !busy && !!profile,
      click: () => {
        if (connected) serialize(disconnect).catch(() => {});
        else if (profile) serialize(() => connect(profile.id)).catch(() => {});
      },
    },
    {
      label: 'Quick Server Select',
      enabled: serverItems.length > 0,
      submenu: serverItems.length ? serverItems : [{ label: 'No configs available', enabled: false }],
    },
    { type: 'separator' },
    { label: 'Open FIST', click: () => mainWindow && mainWindow.show() },
    {
      label: 'Settings',
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.webContents.send('open-settings');
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function updateLatencyPolling() {
  if (latencyTimer) { clearInterval(latencyTimer); latencyTimer = null; }
  if (connectionState !== 'connected' || !currentPorts) return;
  const ports = currentPorts;
  const poll = async () => {
    if (latencyPollInFlight) return;
    latencyPollInFlight = true;
    try {
      const ms = await proxyPing(ports.httpPort);
      if (mainWindow && !mainWindow.isDestroyed() && connectionState === 'connected' && currentPorts === ports) {
        mainWindow.webContents.send('latency-update', { ms });
      }
    } finally {
      latencyPollInFlight = false;
    }
  };
  poll();
  latencyTimer = setInterval(poll, LATENCY_POLL_MS);
}

function updateTrafficPolling() {
  if (trafficTimer) { clearInterval(trafficTimer); trafficTimer = null; }
  if (statsClient) { statsClient.close(); statsClient = null; }
  if (connectionState !== 'connected' || !currentPorts || !currentPorts.apiPort) return;

  const ports = currentPorts;
  sessionTraffic = { uplink: 0, downlink: 0 };
  let last = { uplink: 0, downlink: 0, time: Date.now() };

  try {
    statsClient = createStatsClient(ports.apiPort, singboxCaps.capabilities(singboxBin).apiKind);
    if (!statsClient) return; // binary serves no stats API -- tunnel still works
  } catch {
    return; // Stats are a nice-to-have; a failure here must not break the connection.
  }

  const poll = async () => {
    if (trafficPollInFlight || currentPorts !== ports) return;
    trafficPollInFlight = true;
    try {
      const { uplink, downlink } = await statsClient.queryOutboundTraffic('proxy');
      const now = Date.now();
      const elapsed = Math.max((now - last.time) / 1000, 0.001);
      const uplinkSpeed = Math.max(0, (uplink - last.uplink) / elapsed);
      const downlinkSpeed = Math.max(0, (downlink - last.downlink) / elapsed);
      last = { uplink, downlink, time: now };
      sessionTraffic = { uplink, downlink };

      if (process.env.SC_DEBUG) console.log('[traffic]', uplink, downlink);
      if (mainWindow && !mainWindow.isDestroyed() && connectionState === 'connected' && currentPorts === ports) {
        const profile = findProfile(store.get('activeProfileId'));
        const lifetimeBase = profile ? (profile.totalBytes || 0) : 0;
        mainWindow.webContents.send('traffic-update', {
          uplink, downlink, uplinkSpeed, downlinkSpeed,
          sessionTotal: uplink + downlink,
          lifetimeTotal: lifetimeBase + uplink + downlink,
        });
      }
    } catch (err) {
      // Transient gRPC hiccup -- skip this tick, try again next interval.
      if (process.env.SC_DEBUG) console.error('[traffic] poll error:', err.message);
    } finally {
      trafficPollInFlight = false;
    }
  };
  poll();
  trafficTimer = setInterval(poll, TRAFFIC_POLL_MS);
}

function persistSessionTraffic() {
  if (sessionTraffic.uplink === 0 && sessionTraffic.downlink === 0) return;
  const profileId = store.get('activeProfileId');
  if (!profileId) return;
  const profiles = store.get('profiles', []);
  const profile = profiles.find((p) => p.id === profileId);
  if (profile) {
    profile.totalBytes = (profile.totalBytes || 0) + sessionTraffic.uplink + sessionTraffic.downlink;
    store.set('profiles', profiles);
  }
  sessionTraffic = { uplink: 0, downlink: 0 };
}

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');

function createWindow() {
  mainWindow = new BrowserWindow({
    // Compact utility-window proportions, like the mainstream VPN clients:
    // a narrow always-at-hand panel rather than a full desktop app window.
    // The locations list and the settings panes are overlays inside this
    // footprint instead of side-by-side columns.
    width: 380,
    height: 640,
    minWidth: 360,
    minHeight: 560,
    maxWidth: 520,
    backgroundColor: '#0a0d13',
    autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    frame: false, // fully custom title bar, drawn in the renderer
    roundedCorners: true, // native DWM corner rounding on Windows 11 when not maximized
    show: false, // paired with 'ready-to-show' below so launch never flashes an unpainted frame
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  // No aspect lock: the compact layout is a tall panel that stretches
  // vertically, not the old 1:1 square.

  mainWindow.once('ready-to-show', () => {
    const settings = getSettings();
    if (settings.startMinimized) {
      // Tray-enabled: stay fully hidden -- the tray icon's click handler
      // (and its "Open" menu item) already call mainWindow.show() to restore.
      if (!settings.minimizeToTray) {
        mainWindow.show();
        mainWindow.minimize();
      }
    } else {
      mainWindow.show();
    }
  });

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(indexPath);

  // Hand off to the real browser, but only for schemes that are safe to pass
  // to the OS. shell.openExternal will happily act on file:// (and on Windows
  // UNC paths), which would let attacker-influenced text in the renderer --
  // a config name, a marketplace listing, an extension description -- launch
  // a local file. Anything that isn't plain web/mail is dropped.
  const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (EXTERNAL_SCHEMES.has(new URL(url).protocol)) shell.openExternal(url);
    } catch { /* unparseable URL -- ignore */ }
    return { action: 'deny' };
  });

  // The renderer only ever loads our own bundled index.html. Any attempt to
  // navigate it somewhere else (an injected link, a redirect) would replace
  // the trusted origin that holds the IPC bridge, so refuse and send it to
  // the browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      try {
        if (EXTERNAL_SCHEMES.has(new URL(url).protocol)) shell.openExternal(url);
      } catch { /* unparseable URL -- ignore */ }
    }
  });

  const sendWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-state', {
        maximized: mainWindow.isMaximized(),
        fullscreen: mainWindow.isFullScreen(),
      });
    }
  };
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.webContents.once('did-finish-load', sendWindowState);

  mainWindow.on('close', (e) => {
    if (!isQuitting && getSettings().minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
    // Otherwise let the window close normally; the 'will-quit' handler is the
    // single authoritative gate that disconnects before the app actually exits.
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(APP_ICON_PATH);
  try {
    tray = new Tray(icon);
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => mainWindow && mainWindow.show());
  } catch {
    tray = null;
  }
}

function findProfile(id) {
  return store.get('profiles', []).find((p) => p.id === id);
}

async function connect(profileId) {
  const profile = findProfile(profileId);
  if (!profile) throw new Error('Config not found');
  if (profile.protocol === 'mtproto') {
    throw new Error('MTProto configs cannot be tunneled; use them directly in Telegram');
  }
  const usesExtension = profile.engine && profile.engine !== 'sing-box';
  if (!usesExtension && !fs.existsSync(singboxBin)) {
    // The antivirus explanation only makes sense on Windows; on macOS/Linux
    // the overwhelmingly likely cause is that the binary was never fetched
    // (bin/ is gitignored and has to be installed separately).
    throw new Error(
      process.platform === 'win32'
        ? 'The connection core (sing-box) was not found. Your antivirus may have removed or quarantined it. Add the app folder to your antivirus exclusions, then reinstall or relaunch the app.'
        : `The connection core (sing-box) was not found at ${singboxBin}. Run "npm run ensure:singbox -w packages/desktop" to download it (see the README's "Get the sing-box binary" section).`
    );
  }
  if (connectionState === 'connected' || connectionState === 'connecting') {
    await disconnect();
  }
  const mode = store.get('connectionMode', 'tun');

  // Full Tunnel needs root to create the TUN device and install routes.
  // Elevation happens here rather than at startup: relaunchElevated exits
  // this process as soon as the pkexec/UAC helper spawns, so doing it before
  // a window exists means a failed prompt makes the app disappear with no
  // way to report why. Asking on an explicit Connect keeps the failure
  // visible and attributable.
  if (mode === 'tun' && !usesExtension && !(await isElevated())) {
    notify('Administrator Access Required', 'Full Tunnel needs administrator/root access. The app will reopen with it…');
    const relaunched = await relaunchElevated(app);
    if (!relaunched) {
      connectionState = 'disconnected';
      sendState();
      throw new Error('Full Tunnel needs administrator/root access. Approve the prompt, or start the app with elevated privileges.');
    }
    return; // this instance is exiting; the elevated one takes over
  }

  connectionState = 'connecting';
  sendState();
  const settings = getSettings();

  // Plug-and-play path: an extension owns everything about this connection
  // itself (its own local proxy/TUN/routing) -- we just spawn it and relay
  // its state, the same way we relay sing-box's.
  if (usesExtension) {
    try {
      const engine = new extensionHost.ExtensionEngine(userDataDir, profile.engine);
      engine.on('log', (text) => {
        const entry = { t: Date.now(), text };
        proxyLogRing.push(entry);
        if (proxyLogRing.length > MAX_PROXY_LOGS) proxyLogRing.splice(0, proxyLogRing.length - MAX_PROXY_LOGS);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('proxy-log', entry);
      });
      engine.on('exit', handleEngineExit);
      await engine.start(profile);
      activeEngine = engine;
      store.set('activeProfileId', profileId);
      store.set('activeMode', mode);
      const profiles = store.get('profiles', []);
      const p = profiles.find((x) => x.id === profileId);
      if (p) { p.lastUsedAt = Date.now(); store.set('profiles', profiles); }
      currentPorts = null; // the extension manages its own local ports, if any
      connectedAt = Date.now();
      reconnectAttempts = 0;
      connectionState = 'connected';
      sendState();
      notify('FIST', `Connected to "${profile.name}" via extension`);
      return;
    } catch (err) {
      connectionState = 'disconnected';
      currentPorts = null;
      connectedAt = null;
      sendState();
      throw err;
    }
  }

  activeEngine = singbox;
  try {
    const socksPort = await findFreePort(settings.socksPort);
    const preferredHttp = settings.httpPort === socksPort ? settings.httpPort + 1 : settings.httpPort;
    const httpPort = await findFreePort(preferredHttp);
    const apiPort = await findFreePort(API_PORT === socksPort || API_PORT === httpPort ? httpPort + 1 : API_PORT);
    // Auto-failover tiers: other saved servers, best-protocol-first, so a
    // censor killing one transport (e.g. throttling UDP and taking out
    // Hysteria2) moves traffic to a surviving tier without user action.
    // Deliberately capped -- each tier is a live outbound sing-box probes.
    let fallbackProfiles;
    if (settings.autoFallback) {
      const TIER_ORDER = { hysteria2: 0, vless: 1, trojan: 2, vmess: 3, shadowsocks: 4 };
      fallbackProfiles = store.get('profiles', [])
        .filter((p) => p.id !== profileId
          && p.protocol !== 'mtproto' && p.protocol !== 'wireguard'
          && p.network !== 'kcp'
          && p.engine !== 'extension' && p.protocol !== 'extension')
        .sort((a, b) => (TIER_ORDER[a.protocol] ?? 9) - (TIER_ORDER[b.protocol] ?? 9))
        .slice(0, 3);
    }

    const buildConfig = (overrides = {}) => buildSingboxConfig(profile, {
      socksPort, httpPort, apiPort, mode, logLevel: settings.singboxLogLevel,
      // Emitting an API block this build can't serve makes sing-box refuse to
      // start outright, so ask only for what it was compiled with.
      apiKind: singboxCaps.capabilities(singboxBin).apiKind,
      // Keep sing-box's cache next to its generated config, in the app's
      // writable data dir, rather than beside the binary.
      cacheFilePath: path.join(singboxWorkDir, 'cache.db'),
      socksHost: settings.socksHost, httpHost: settings.httpHost,
      socksAccounts: settings.socksUsername ? [{ user: settings.socksUsername, pass: settings.socksPassword || '' }] : undefined,
      httpAccounts: settings.httpUsername ? [{ user: settings.httpUsername, pass: settings.httpPassword || '' }] : undefined,
      // Censorship-resistance layers (see settingsSchema.js).
      utlsFingerprint: settings.utlsFingerprint,
      dnsMode: settings.dnsMode,
      remoteDns: settings.remoteDns,
      localDns: settings.localDns,
      dnsStrategy: settings.dnsStrategy,
      tlsFragment: settings.tlsFragment,
      routingMode: settings.routingMode,
      directRuleSets: settings.directRuleSets,
      blockAds: settings.blockAds,
      tunStack: settings.tunStack,
      fallbackProfiles,
      // Advanced power features (require server support; off by default).
      mux: settings.muxEnabled ? {
        enabled: true,
        protocol: settings.muxProtocol,
        padding: settings.muxPadding,
        maxConnections: settings.muxMaxConnections,
        brutalUp: settings.brutalUpMbps,
        brutalDown: settings.brutalDownMbps,
      } : undefined,
      udpOverTcp: settings.udpOverTcp,
      tlsRecordFragment: settings.tlsRecordFragment,
      tlsHandshakeFragment: settings.tlsHandshakeFragment,
      ech: settings.ech,
      ...overrides,
    });
    const config = buildConfig();
    // Full Tunnel's strict_route needs IPv6 policy routing. Hosts with IPv6
    // disabled reject those rules and sing-box dies at startup with
    // "address family not supported by protocol". Rather than leaving the
    // user with a mode that simply refuses to work, retry once without it --
    // auto_route still captures traffic, only the extra anti-leak rules are
    // dropped, so say so instead of failing silently.
    try {
      await singbox.start(config);
    } catch (err) {
      const ipv6RuleFailure = mode === 'tun'
        && /address family not supported|set rules|add rule/i.test(err.message || '');
      if (!ipv6RuleFailure) throw err;
      console.warn('[tun] strict_route unsupported on this host, retrying without it');
      const relaxed = buildConfig({ tunStrictRoute: false });
      await singbox.start(relaxed);
      notify('FIST', 'Full Tunnel started with reduced leak protection (this system does not support strict routing).');
    }
    store.set('activeProfileId', profileId);
    store.set('activeMode', mode);
    {
      // Remember when this profile was last used, for "recently used" sorting.
      const profiles = store.get('profiles', []);
      const p = profiles.find((x) => x.id === profileId);
      if (p) { p.lastUsedAt = Date.now(); store.set('profiles', profiles); }
    }
    currentPorts = { socksPort, httpPort, apiPort };
    connectedAt = Date.now();
    reconnectAttempts = 0;
    connectionState = 'connected';

    sendState();
    notify('FIST', `Connected to "${profile.name}"`);
    if (getSettings().killSwitchEnabled) {
      killSwitchArmed = true;
      await clearKillSwitchBlock();
    }
  } catch (err) {
    connectionState = 'disconnected';
    currentPorts = null;
    connectedAt = null;
    sendState();
    if (mode === 'tun' && /access is denied/i.test(err.message || '')) {
      throw new Error('Full Tunnel mode requires running the app with administrator/root access');
    }
    if (err.code === 'ENOENT') {
      // The antivirus explanation only makes sense on Windows; on macOS/Linux
    // the overwhelmingly likely cause is that the binary was never fetched
    // (bin/ is gitignored and has to be installed separately).
    throw new Error(
      process.platform === 'win32'
        ? 'The connection core (sing-box) was not found. Your antivirus may have removed or quarantined it. Add the app folder to your antivirus exclusions, then reinstall or relaunch the app.'
        : `The connection core (sing-box) was not found at ${singboxBin}. Run "npm run ensure:singbox -w packages/desktop" to download it (see the README's "Get the sing-box binary" section).`
    );
    }
    throw err;
  }
}

// Safety net: a dead local proxy port left as the active Windows system proxy
// means no internet for the user, so any time the tunnel actually stops we
// clear system proxy too. This is distinct from systemProxy:disable, which
// the user can call independently at any time without touching the tunnel.
async function disableSystemProxySafetyNet() {
  if (!store.get('systemProxyEnabled', false)) return;
  try { await systemProxy.disable(); } catch { /* ignore */ }
  store.set('systemProxyEnabled', false);
}

// Engages the outbound-block firewall rules. Idempotent and best-effort --
// if it fails (most likely: not actually elevated), we surface a notification
// but must not claim protection we don't have, so killSwitchBlocking stays false.
async function applyKillSwitchBlock() {
  if (killSwitchBlocking) return;
  try {
    // Windows Firewall matches sing-box's own process directly and ignores
    // this; macOS (pf) and Linux (nftables) have no per-process matching, so
    // they instead allow-list the active profile's own remote endpoint.
    const profile = findProfile(store.get('activeProfileId'));
    const remote = profile ? { host: profile.address, port: profile.port } : null;
    await killSwitch.enable(singboxBin, remote);
    killSwitchBlocking = true;
  } catch (err) {
    notify('Kill Switch Error', 'Failed to block traffic: ' + (err.message || ''));
  }
  sendState();
}

// Lifts the block. Always safe to call even if nothing is currently
// blocking -- this is also the emergency escape hatch invoked the moment
// the user flips the setting off.
async function clearKillSwitchBlock() {
  if (!killSwitchBlocking) return;
  try { await killSwitch.disable(); } catch { /* best effort */ }
  killSwitchBlocking = false;
  sendState();
}

async function disconnect() {
  if (connectionState === 'disconnected') return;
  connectionState = 'disconnecting';
  sendState();
  await disableSystemProxySafetyNet();
  expectedExit = true;
  await activeEngine.stop();
  connectionState = 'disconnected';
  persistSessionTraffic();
  currentPorts = null;
  connectedAt = null;
  sendState();
  // Kill Switch means "no traffic outside the tunnel, for any reason" --
  // that includes the user's own deliberate disconnect, not just drops.
  if (killSwitchArmed && getSettings().killSwitchEnabled) {
    await applyKillSwitchBlock();
  }
}

// Detects the tunnel dropping on its own (crash, server-side kick, network
// change) as opposed to a user-initiated disconnect, and tries to recover.
// Shared between the built-in sing-box engine and any ExtensionEngine, so a
// plugin-driven connection gets the exact same drop/reconnect handling.
async function handleEngineExit() {
  if (expectedExit) { expectedExit = false; return; }
  if (connectionState !== 'connected') return;

  connectionState = 'disconnected';
  persistSessionTraffic();
  currentPorts = null;
  connectedAt = null;
  sendState();

  const killSwitchSettings = getSettings();
  if (killSwitchArmed && killSwitchSettings.killSwitchEnabled) {
    // Block immediately -- before any reconnect attempt -- so the gap while
    // we're retrying (which can take several seconds) never leaks traffic.
    // A successful reconnect (below, or a later retry) lifts it again via
    // connect()'s own success path.
    await applyKillSwitchBlock();
  }

  if (!getSettings().autoReconnect) {
    await disableSystemProxySafetyNet();
    notify('Disconnected', 'The tunnel dropped unexpectedly.');
    return;
  }

  const profileId = store.get('activeProfileId');
  if (!profileId || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    await disableSystemProxySafetyNet();
    notify('Disconnected', 'Reconnection attempts failed.');
    reconnectAttempts = 0;
    return;
  }

  reconnectAttempts++;
  notify('Disconnected', `Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
  await new Promise((r) => setTimeout(r, 2000 * reconnectAttempts));
  try {
    await serialize(() => connect(profileId));
    // A successful reconnect can land on a different port than before (port
    // conflict fallback) -- if system proxy was on, resync it to the new
    // port instead of leaving it pointed at the now-dead old one.
    if (store.get('systemProxyEnabled', false) && currentPorts) {
      try {
        await systemProxy.enable('127.0.0.1', currentPorts.httpPort, systemProxy.buildBypass(getSettings().customBypass));
      } catch { /* ignore */ }
    }
  } catch { /* the engine's own 'exit' event will fire again and retry, up to the cap */ }
}
singbox.on('exit', handleEngineExit);

app.whenReady().then(async () => {
  app.setAppUserModelId('com.fist.app');

  // One-time migration off the old System Proxy mode. Earlier versions could
  // leave the OS pointed at our local listener; now that Full Tunnel is the
  // only routing mode, that setting would never be cleared by us again and
  // the user would be stuck with a proxy entry aimed at a dead port -- i.e.
  // no internet at all. Clear it once, on the first launch after upgrading.
  if (store.get('systemProxyEnabled', false)) {
    try { await systemProxy.disable(); } catch { /* best effort */ }
    store.set('systemProxyEnabled', false);
  }

  // Deliberately NOT elevating here. Full Tunnel is the only mode now, so
  // every launch would hit this path -- and relaunchElevated exits this
  // process the moment the pkexec/UAC helper *spawns*, long before the
  // elevated instance is known to have started. If that helper then fails
  // (no PolicyKit agent, prompt dismissed, elevated launch errors), the app
  // has already quit and nothing comes back: it just vanishes at startup.
  //
  // Elevation is requested when the user actually connects instead, where
  // there's a window to report failure in.

  createWindow();
  createTray();

  initUpdater(mainWindow);
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates().catch(() => {}), 5000);
  }

  const settings = getSettings();
  app.setLoginItemSettings({ openAtLogin: !!settings.launchOnStartup });
  scheduleSubAutoUpdate();

  // Sync in-memory Kill Switch state with whatever's actually on the
  // firewall right now. If the feature is off, proactively clean up any
  // rule left behind by a previous crash -- the stored preference is the
  // source of truth for whether blocking *should* be happening. If it's on,
  // leave a lingering block exactly as-is: that's the previous session's
  // protection still doing its job until the user reconnects or disables it.
  if (!settings.killSwitchEnabled) {
    killSwitch.disable().catch(() => {});
  } else {
    killSwitch.isActive().then((active) => {
      killSwitchBlocking = active;
      sendState();
    }).catch(() => {});
  }

  if (settings.runLocalProxyOnStartup) {
    const profileId = store.get('activeProfileId');
    if (profileId && findProfile(profileId)) {
      serialize(() => connect(profileId)).then(
        () => { if (process.env.SC_DEBUG) console.log('[connect] resolved, state=', connectionState); },
        (err) => { if (process.env.SC_DEBUG) console.error('[connect] rejected:', err); }
      );
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async (e) => {
  if (connectionState !== 'disconnected') {
    e.preventDefault();
    await serialize(disconnect);
    store.flush();
    app.quit();
  } else {
    store.flush();
  }
});

// ---- IPC handlers ----

// ---- Window controls (custom title bar) ----

ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => { mainWindow?.close(); });
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized());

ipcMain.handle('profiles:list', () => ({
  profiles: store.get('profiles', []),
  subscriptions: store.get('subscriptions', []),
  activeProfileId: store.get('activeProfileId', null),
  connectionMode: store.get('connectionMode', 'tun'),
  connectionState,
  connectedAt,
  settings: getSettings(),
  systemProxyEnabled: store.get('systemProxyEnabled', false),
  killSwitchBlocking,
}));

ipcMain.handle('settings:setMode', async (_e, mode) => {
  if (mode !== 'proxy' && mode !== 'tun') throw new Error('Invalid mode');
  if (connectionState !== 'disconnected') throw new Error('Disconnect first');

  // Persist the requested mode *before* possibly relaunching elevated --
  // relaunchElevated calls app.exit() as soon as the elevated instance is
  // confirmed launched, which aborts this handler mid-flight. Setting the
  // store first means the new elevated instance actually boots into 'tun'
  // instead of silently coming back up in 'proxy' and making the click look
  // like it did nothing.
  store.set('connectionMode', mode);

  if (mode === 'tun' && !(await isElevated())) {
    notify('Relaunching with Administrator Access', 'Full Tunnel mode requires administrator/root access. The app will reopen shortly…');
    const relaunched = await relaunchElevated(app);
    if (!relaunched) {
      throw new Error('You must approve the administrator/root access request to enable Full Tunnel mode');
    }
    return mode; // unreachable in practice -- app.exit() fires inside relaunchElevated
  }

  return mode;
});

ipcMain.handle('profiles:addLink', (_e, link) => {
  // parseConfigText covers a single share link (the common case), a .fist
  // bundle (possibly many profiles), or a pasted WireGuard .conf -- all
  // come back as an array so this one handler covers all three.
  const parsed = parseConfigText(link);
  if (!parsed.length) throw new Error('Invalid or unsupported config');
  const profiles = store.get('profiles', []);
  profiles.push(...parsed);
  store.set('profiles', profiles);
  return parsed.length === 1 ? parsed[0] : parsed;
});

ipcMain.handle('profiles:addFile', async (_e) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Config File',
    filters: [
      // npvt/npv4/inpv are NapsternetV exports -- readable when they're a
      // plain-text export, and given a specific explanation when they're the
      // app's encrypted container (see parseNapsternetFile).
      { name: 'Supported configs', extensions: ['fist', 'conf', 'txt', 'json', 'npvt', 'npv4', 'inpv'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };

  let text;
  try {
    text = fs.readFileSync(filePaths[0], 'utf8');
  } catch {
    throw new Error('Could not read the selected file');
  }

  // parseConfigText throws its own specific message for formats we recognise
  // but cannot decode (an encrypted NapsternetV file being the case that
  // motivated this) -- let that reach the user instead of flattening it into
  // the generic "no supported configs" below.
  const parsed = parseConfigText(text);
  if (!parsed.length) throw new Error('No supported configs found in that file');

  const profiles = store.get('profiles', []);
  profiles.push(...parsed);
  store.set('profiles', profiles);
  return { canceled: false, profiles: parsed };
});

ipcMain.handle('profiles:exportFist', async (_e, ids) => {
  const all = store.get('profiles', []);
  const selected = Array.isArray(ids) && ids.length ? all.filter((p) => ids.includes(p.id)) : all;
  if (!selected.length) throw new Error('No configs to export');

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export as .fist',
    defaultPath: `fist-export-${new Date().toISOString().slice(0, 10)}.fist`,
    filters: [{ name: 'FIST bundle', extensions: ['fist'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  fs.writeFileSync(filePath, encodeFistBundle(selected));
  return { canceled: false, filePath, count: selected.length };
});

// Plug-and-play: adds a config the built-in parsers didn't recognize, using
// whichever engine the user explicitly picked -- either our own sing-box
// (as a raw outbound JSON passthrough) or an installed extension.
ipcMain.handle('profiles:addWithEngine', async (_e, { text, engine }) => {
  let profile;
  if (engine === 'sing-box') {
    profile = parseRawOutbound(text);
    if (!profile) throw new Error('That does not look like a valid sing-box outbound JSON object (needs at least a "type" field)');
  } else {
    const parsed = await extensionHost.parseWithExtension(userDataDir, engine, text);
    profile = {
      id: newId(),
      protocol: 'extension',
      engine,
      link: 'extension-config',
      name: parsed.name || `${parsed.address || 'unknown'}:${parsed.port || ''}`,
      address: parsed.address || '',
      port: Number(parsed.port) || 0,
      rawConfig: text,
      createdAt: Date.now(),
      subId: null,
    };
  }
  const profiles = store.get('profiles', []);
  profiles.push(profile);
  store.set('profiles', profiles);
  return profile;
});

ipcMain.handle('extensions:list', () => extensionHost.listExtensions(userDataDir));

ipcMain.handle('extensions:install', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Install Extension (select its folder)',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  const manifest = extensionHost.installExtension(userDataDir, filePaths[0]);
  return { canceled: false, extension: manifest };
});

ipcMain.handle('extensions:remove', (_e, id) => {
  extensionHost.removeExtension(userDataDir, id);
  return extensionHost.listExtensions(userDataDir);
});

ipcMain.handle('profiles:addCustom', (_e, fields) => {
  const profile = buildCustomProfile(fields);
  const profiles = store.get('profiles', []);
  profiles.push(profile);
  store.set('profiles', profiles);
  return profile;
});

ipcMain.handle('profiles:delete', async (_e, id) => {
  if (store.get('activeProfileId') === id) {
    await serialize(disconnect);
    store.set('activeProfileId', null);
  }
  const profiles = store.get('profiles', []).filter((p) => p.id !== id);
  store.set('profiles', profiles);
  return profiles;
});

ipcMain.handle('profiles:rename', (_e, { id, name }) => {
  const profiles = store.get('profiles', []);
  const p = profiles.find((x) => x.id === id);
  if (p) p.name = name;
  store.set('profiles', profiles);
  return profiles;
});

ipcMain.handle('profiles:update', (_e, { id, link }) => {
  const parsed = parseLink(link);
  if (!parsed) throw new Error('Invalid or unsupported config');
  if (id === store.get('activeProfileId') && connectionState !== 'disconnected') {
    throw new Error('Disconnect first');
  }
  const profiles = store.get('profiles', []);
  const existing = profiles.find((p) => p.id === id);
  if (!existing) throw new Error('Config not found');
  Object.assign(existing, parsed, {
    id: existing.id,
    subId: existing.subId,
    favorite: existing.favorite,
    totalBytes: existing.totalBytes,
    createdAt: existing.createdAt,
    lastUsedAt: existing.lastUsedAt,
  });
  store.set('profiles', profiles);
  return profiles;
});

// Form-based edit (the Custom-tab form re-used for editing) -- takes raw
// field values instead of a pre-built link string, since buildCustomProfile/
// buildLink use Node's Buffer for base64 encoding and so can only run here
// in the main process, not in the renderer's browser context.
ipcMain.handle('profiles:updateCustom', (_e, { id, fields }) => {
  const parsed = buildCustomProfile(fields);
  if (id === store.get('activeProfileId') && connectionState !== 'disconnected') {
    throw new Error('Disconnect first');
  }
  const profiles = store.get('profiles', []);
  const existing = profiles.find((p) => p.id === id);
  if (!existing) throw new Error('Config not found');
  Object.assign(existing, parsed, {
    id: existing.id,
    subId: existing.subId,
    favorite: existing.favorite,
    totalBytes: existing.totalBytes,
    createdAt: existing.createdAt,
    lastUsedAt: existing.lastUsedAt,
  });
  store.set('profiles', profiles);
  return profiles;
});

ipcMain.handle('subscriptions:add', async (_e, url) => {
  const { text, headers } = await fetchText(url);
  const parsed = parseMany(text);
  if (!parsed.length) throw new Error('No configs found in this subscription');
  const usage = parseSubscriptionUserinfo(headers['subscription-userinfo']);
  const sub = { id: newId(), url, name: url, createdAt: Date.now(), lastUpdated: Date.now(), configCount: parsed.length, usage };
  parsed.forEach((p) => { p.subId = sub.id; });

  const subs = store.get('subscriptions', []);
  subs.push(sub);
  store.set('subscriptions', subs);

  const profiles = store.get('profiles', []).concat(parsed);
  store.set('profiles', profiles);
  return { subscription: sub, profiles: parsed };
});

async function refreshSubscription(subId) {
  const subs = store.get('subscriptions', []);
  const sub = subs.find((s) => s.id === subId);
  if (!sub) throw new Error('Subscription not found');
  const { text, headers } = await fetchText(sub.url);
  const parsed = parseMany(text);
  parsed.forEach((p) => { p.subId = subId; });
  const usage = parseSubscriptionUserinfo(headers['subscription-userinfo']);

  const activeId = store.get('activeProfileId');
  const remaining = store.get('profiles', []).filter((p) => p.subId !== subId);
  const wasActiveInSub = activeId && !remaining.find((p) => p.id === activeId);
  const merged = remaining.concat(parsed);
  store.set('profiles', merged);
  if (wasActiveInSub) {
    store.set('activeProfileId', null);
    if (connectionState !== 'disconnected') await serialize(disconnect);
  }

  sub.lastUpdated = Date.now();
  sub.configCount = parsed.length;
  if (usage) sub.usage = usage;
  store.set('subscriptions', subs);

  return { subscription: sub, profiles: parsed };
}

async function refreshAllSubscriptions() {
  const subs = store.get('subscriptions', []);
  // Each refreshSubscription() call's store read-modify-write is a single
  // synchronous span (no `await` in between), so running them concurrently
  // is safe -- and turns N sequential network round-trips into one.
  return Promise.all(subs.map((sub) =>
    refreshSubscription(sub.id).catch((err) => ({ subscription: sub, error: err.message }))
  ));
}

function scheduleSubAutoUpdate() {
  if (subAutoUpdateTimer) { clearInterval(subAutoUpdateTimer); subAutoUpdateTimer = null; }
  const interval = getSettings().subAutoUpdateInterval;
  if (!interval || interval <= 0) return;
  subAutoUpdateTimer = setInterval(async () => {
    const results = await refreshAllSubscriptions();
    if (results.length) {
      notify('Subscriptions Updated', `${results.length} subscriptions checked`);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('profiles-changed');
    }
  }, interval);
}

ipcMain.handle('subscriptions:refresh', async (_e, subId) => {
  return refreshSubscription(subId);
});

ipcMain.handle('subscriptions:delete', async (_e, subId) => {
  const remaining = store.get('profiles', []).filter((p) => p.subId !== subId);
  const removedIds = new Set(
    store.get('profiles', []).filter((p) => p.subId === subId).map((p) => p.id)
  );
  if (removedIds.has(store.get('activeProfileId'))) {
    await serialize(disconnect);
    store.set('activeProfileId', null);
  }
  store.set('profiles', remaining);
  store.set('subscriptions', store.get('subscriptions', []).filter((s) => s.id !== subId));
  return remaining;
});

ipcMain.handle('subscriptions:update', (_e, { id, name, url }) => {
  const subs = store.get('subscriptions', []);
  const sub = subs.find((s) => s.id === id);
  if (!sub) throw new Error('Subscription not found');
  if (name !== undefined) sub.name = name;
  if (url !== undefined) sub.url = url;
  store.set('subscriptions', subs);
  return subs;
});

ipcMain.handle('connection:connect', async (_e, profileId) => {
  await serialize(() => connect(profileId));
  return { connectionState };
});

ipcMain.handle('connection:disconnect', async () => {
  await serialize(disconnect);
  return { connectionState };
});

ipcMain.handle('connection:status', () => ({
  connectionState,
  activeProfileId: store.get('activeProfileId', null),
  killSwitchBlocking,
}));

ipcMain.handle('ping:test', async (_e, profileId) => {
  const profile = findProfile(profileId);
  if (!profile) throw new Error('Config not found');
  const ms = await tcpPing(profile.address, profile.port, 5000);
  return { profileId, ms };
});

// ---- Server Finder test engine ----

function emitTestEvent(token, type, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('test-event', { token, type, ...data });
  }
}

function requireProfile(profileId) {
  const profile = findProfile(profileId);
  if (!profile) throw new Error('Config not found');
  return profile;
}

function requireTunnelableProfile(profileId) {
  const profile = requireProfile(profileId);
  if (profile.protocol === 'mtproto') {
    throw new Error('MTProto configs cannot be tunneled');
  }
  return profile;
}

ipcMain.handle('test:ping', async (_e, { profileId, token }) => {
  const profile = requireProfile(profileId);
  const signal = serverTest.begin(token);
  try {
    return await serverTest.pingStats(profile, {
      signal,
      onSample: (s) => emitTestEvent(token, 'sample', s),
    });
  } finally {
    serverTest.end(token);
  }
});

ipcMain.handle('test:real', async (_e, { profileId, token }) => {
  const profile = requireTunnelableProfile(profileId);
  const signal = serverTest.begin(token);
  try {
    return await serverTest.realPing(profile, {
      singboxBin, workRoot: singboxWorkDir, signal,
      emit: (type, data) => emitTestEvent(token, type, data),
    });
  } finally {
    serverTest.end(token);
  }
});

ipcMain.handle('test:speed', async (_e, { profileId, token }) => {
  const profile = requireTunnelableProfile(profileId);
  const signal = serverTest.begin(token);
  try {
    return await serverTest.speedTest(profile, {
      singboxBin, workRoot: singboxWorkDir, signal,
      emit: (type, data) => emitTestEvent(token, type, data),
    });
  } finally {
    serverTest.end(token);
  }
});

ipcMain.handle('test:cancel', (_e, token) => {
  serverTest.cancel(token);
});

ipcMain.handle('profiles:setFavorite', (_e, { id, favorite }) => {
  const profiles = store.get('profiles', []);
  const p = profiles.find((x) => x.id === id);
  if (p) p.favorite = !!favorite;
  store.set('profiles', profiles);
  return profiles;
});

ipcMain.handle('subscriptions:refreshAll', async () => {
  return refreshAllSubscriptions();
});

ipcMain.handle('settings:get', () => getSettings());

const LOG_LEVELS = new Set(['none', 'error', 'warn', 'info', 'debug']);
const BOOLEAN_SETTINGS = new Set([
  'launchOnStartup', 'runLocalProxyOnStartup', 'startMinimized', 'restorePreviousSession',
  'minimizeToTray', 'autoReconnect', 'killSwitchEnabled',
  'tlsFragment', 'blockAds', 'autoFallback',
  'muxEnabled', 'muxPadding', 'udpOverTcp', 'tlsRecordFragment', 'tlsHandshakeFragment', 'ech',
]);
// Bandwidth caps for TCP Brutal / mux connection count: non-negative integers
// with a sane ceiling so a typo can't ask sing-box for absurd values.
const NUMERIC_SETTINGS = {
  brutalUpMbps: 10000,
  brutalDownMbps: 10000,
  muxMaxConnections: 64,
};
// Enumerated censorship-resistance settings -- rejected unless they name a
// mode the config builder actually understands, so a bad value can never
// reach sing-box and break the tunnel.
const ENUM_SETTINGS = {
  utlsFingerprint: new Set(['none', 'chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random']),
  dnsMode: new Set(['off', 'secure', 'fakeip']),
  dnsStrategy: new Set(['prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only']),
  routingMode: new Set(['global', 'smart']),
  tunStack: new Set(['mixed', 'system', 'gvisor']),
  muxProtocol: new Set(['h2mux', 'smux', 'yamux']),
};
// Rule-set names become URLs, so restrict them to the charset the upstream
// repo actually uses rather than interpolating arbitrary text into a URL.
const RULE_SET_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const PORT_SETTINGS = new Set(['socksPort', 'httpPort']);
const HOST_SETTINGS = new Set(['socksHost', 'httpHost']);
const TEXT_SETTINGS = new Set(['socksUsername', 'socksPassword', 'httpUsername', 'httpPassword']);
const isValidPort = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535;
// Accepts a dotted IPv4 address (with octet range checking) or a bare
// hostname/domain, matching the "127.0.0.1 or any custom IP/domain" spec.
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
function isValidHost(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  const m = v.match(IPV4_RE);
  if (m) return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  return HOSTNAME_RE.test(v);
}

ipcMain.handle('settings:update', async (_e, patch) => {
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  const clean = {};
  for (const key of Object.keys(patch || {})) {
    if (!allowed.has(key)) continue;
    const value = patch[key];
    if (BOOLEAN_SETTINGS.has(key)) {
      if (typeof value !== 'boolean') continue;
    } else if (key === 'subAutoUpdateInterval') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    } else if (key === 'singboxLogLevel') {
      if (!LOG_LEVELS.has(value)) continue;
    } else if (PORT_SETTINGS.has(key)) {
      if (!isValidPort(value)) continue;
    } else if (HOST_SETTINGS.has(key)) {
      if (!isValidHost(value)) continue;
    } else if (TEXT_SETTINGS.has(key)) {
      if (typeof value !== 'string' || value.length > 256) continue;
    } else if (key === 'customBypass') {
      if (typeof value !== 'string' || value.length > 2000) continue;
    } else if (ENUM_SETTINGS[key]) {
      if (!ENUM_SETTINGS[key].has(value)) continue;
    } else if (key === 'directRuleSets') {
      if (!Array.isArray(value) || value.length > 12) continue;
      if (!value.every((n) => typeof n === 'string' && RULE_SET_NAME_RE.test(n))) continue;
    } else if (key === 'remoteDns' || key === 'localDns') {
      if (typeof value !== 'string' || value.length > 256 || !value.trim()) continue;
    } else if (NUMERIC_SETTINGS[key]) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > NUMERIC_SETTINGS[key]) continue;
    }
    clean[key] = value;
  }

  if ('socksPort' in clean || 'httpPort' in clean) {
    const prospective = { ...getSettings(), ...clean };
    if (prospective.socksPort === prospective.httpPort) {
      throw new Error('SOCKS and HTTP ports must be different');
    }
  }

  if ('killSwitchEnabled' in clean) {
    if (clean.killSwitchEnabled) {
      if (!(await isElevated())) {
        notify('Relaunching with Administrator Access', 'Kill Switch requires administrator/root access. The app will reopen shortly…');
        const relaunched = await relaunchElevated(app);
        if (!relaunched) {
          throw new Error('You must approve the administrator/root access request to enable Kill Switch');
        }
        return; // unreachable in practice -- app.exit() fires inside relaunchElevated
      }
      // Already connected when the user turns this on: arm immediately so a
      // drop later in *this* session is still caught, instead of waiting for
      // the next successful connect() to set the flag.
      if (connectionState === 'connected') killSwitchArmed = true;
    } else {
      // Turning it off is the emergency escape hatch -- always lift any
      // active block right away, regardless of connection state.
      await clearKillSwitchBlock();
      killSwitchArmed = false;
    }
  }

  const settings = updateSettings(clean);

  if ('launchOnStartup' in clean) {
    app.setLoginItemSettings({ openAtLogin: !!settings.launchOnStartup });
  }
  if ('subAutoUpdateInterval' in clean) {
    scheduleSubAutoUpdate();
  }
  return settings;
});

ipcMain.handle('app:openLogsFolder', () => {
  shell.openPath(singboxWorkDir);
});

ipcMain.handle('app:openProxyFolder', () => {
  shell.openPath(singboxWorkDir);
});

// System Proxy is fully decoupled from the tunnel: enabling it only points
// Windows at the already-running local proxy, disabling it only resets the
// registry -- neither one starts/stops sing-box.
ipcMain.handle('systemProxy:enable', async () => {
  if (connectionState !== 'connected' || !currentPorts) {
    throw new Error('Turn on the local proxy first (connect to a server)');
  }
  const settings = getSettings();
  await systemProxy.enable('127.0.0.1', currentPorts.httpPort, systemProxy.buildBypass(settings.customBypass));
  store.set('systemProxyEnabled', true);
  sendState();
  return true;
});

ipcMain.handle('systemProxy:disable', async () => {
  await systemProxy.disable();
  store.set('systemProxyEnabled', false);
  sendState();
  return true;
});

ipcMain.handle('network:testConnection', async (_e, { protocol }) => {
  if (connectionState !== 'connected' || !currentPorts) {
    return { ok: false, reason: 'not-running', message: 'The local proxy is not running' };
  }
  const settings = getSettings();
  const isSocks = protocol === 'socks';
  return testLocalProxy({
    protocol,
    host: '127.0.0.1',
    port: isSocks ? currentPorts.socksPort : currentPorts.httpPort,
    username: isSocks ? settings.socksUsername : settings.httpUsername,
    password: isSocks ? settings.socksPassword : settings.httpPassword,
  });
});

ipcMain.handle('network:getRecentLogs', () => proxyLogRing);

const NETWORK_RESET_KEYS = ['socksHost', 'socksPort', 'socksUsername', 'socksPassword', 'httpHost', 'httpPort', 'httpUsername', 'httpPassword', 'customBypass'];
ipcMain.handle('network:resetDefaults', () => {
  if (connectionState !== 'disconnected') throw new Error('Disconnect first');
  const patch = {};
  for (const key of NETWORK_RESET_KEYS) patch[key] = DEFAULT_SETTINGS[key];
  return updateSettings(patch);
});

ipcMain.handle('app:getInfo', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
}));

ipcMain.handle('updater:check', () => checkForUpdates());
ipcMain.handle('updater:download', () => downloadUpdate());
ipcMain.handle('updater:install', () => quitAndInstall());

ipcMain.handle('profiles:resetUsage', (_e, id) => {
  const profiles = store.get('profiles', []);
  const p = profiles.find((x) => x.id === id);
  if (p) p.totalBytes = 0;
  store.set('profiles', profiles);
  return profiles;
});

ipcMain.handle('profiles:resetAllUsage', () => {
  const profiles = store.get('profiles', []).map((p) => ({ ...p, totalBytes: 0 }));
  store.set('profiles', profiles);
  return profiles;
});

ipcMain.handle('app:exportBackup', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Back Up Configs',
    defaultPath: `fist-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const backup = {
    version: 1,
    exportedAt: Date.now(),
    profiles: store.get('profiles', []),
    subscriptions: store.get('subscriptions', []),
    settings: getSettings(),
  };
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf8');
  return { canceled: false, filePath };
});

ipcMain.handle('app:saveImage', async (_e, { dataUrl, defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save QR Image',
    defaultPath: defaultName || 'qrcode.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return { canceled: false, filePath };
});

ipcMain.handle('app:copyImage', (_e, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  clipboard.writeImage(img);
  return true;
});

ipcMain.handle('app:importBackup', async () => {
  if (connectionState !== 'disconnected') throw new Error('Disconnect first');

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Configs',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch {
    throw new Error('Invalid backup file');
  }
  if (!Array.isArray(data.profiles)) throw new Error('Invalid backup file');

  store.set('profiles', data.profiles);
  store.set('subscriptions', Array.isArray(data.subscriptions) ? data.subscriptions : []);
  if (data.settings && typeof data.settings === 'object') {
    const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));
    const clean = {};
    for (const key of Object.keys(data.settings)) {
      if (allowedKeys.has(key)) clean[key] = data.settings[key];
    }
    updateSettings(clean);
  }
  store.set('activeProfileId', null);
  return { canceled: false, profiles: data.profiles.length };
});
