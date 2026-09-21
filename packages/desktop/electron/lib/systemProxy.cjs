'use strict';
const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// RFC1918 private ranges only. NOTE: this must enumerate every 172.16-172.31
// octet explicitly -- a broad "172.2*" wildcard here previously matched
// Google/YouTube's own public CDN ranges (172.217.0.0/16, 172.253.0.0/16),
// which silently bypassed the proxy for exactly those sites while everything
// else worked fine.
const PRIVATE_172_RANGE = Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*`).join(';');
const DEFAULT_BYPASS = `localhost;127.*;10.*;${PRIVATE_172_RANGE};192.168.*;<local>`;

// Appends the user's own extra bypass entries (settings.customBypass, a
// semicolon/comma/newline-separated list) to the built-in private-range list.
// The result is always this app's one canonical semicolon-joined spec --
// each platform's enable() below reformats it into whatever that OS's proxy
// settings actually expect.
function buildBypass(customBypass) {
  if (!customBypass) return DEFAULT_BYPASS;
  const extra = customBypass
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!extra.length) return DEFAULT_BYPASS;
  return `${DEFAULT_BYPASS};${extra.join(';')}`;
}

// ---- Windows: WinINet registry (system-wide, all apps that read it) ----

const WIN_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function winBroadcastSettingsChange() {
  // Tell already-running WinINet-based apps (Edge, IE-based components, etc.)
  // to pick up the registry change immediately. INTERNET_OPTION_SETTINGS_CHANGED
  // (39) alone is not enough -- INTERNET_OPTION_REFRESH (37) must follow it or
  // already-open apps keep using their cached (old) proxy config until restarted.
  return new Promise((resolve) => {
    execFile('rundll32.exe', ['wininet.dll,InternetSetOption', '0', '39', '0', '0'], () => {
      execFile('rundll32.exe', ['wininet.dll,InternetSetOption', '0', '37', '0', '0'], () => resolve());
    });
  });
}

async function winEnable(host, port, bypass) {
  // Explicit per-protocol form instead of a bare "host:port" -- removes any
  // ambiguity about whether HTTPS traffic is actually covered.
  const proxyServer = `http=${host}:${port};https=${host}:${port}`;
  await run('reg.exe', ['add', WIN_REG_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', proxyServer, '/f']);
  await run('reg.exe', ['add', WIN_REG_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', bypass, '/f']);
  await run('reg.exe', ['add', WIN_REG_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
  await winBroadcastSettingsChange();
}

async function winDisable() {
  await run('reg.exe', ['add', WIN_REG_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
  await winBroadcastSettingsChange();
}

// ---- macOS: networksetup, applied to every active network service ----
// (there's no single OS-wide proxy switch like Windows' WinINet registry --
// each network service, Wi-Fi/Ethernet/etc, has its own proxy settings)

async function macActiveServices() {
  const out = await run('networksetup', ['-listallnetworkservices']);
  return out
    .split('\n')
    .slice(1) // first line is a instructional header, not a service
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('*')); // '*' prefix = disabled service
}

function macBypassDomains(bypass) {
  // networksetup takes plain space-separated domains/hosts, no wildcards or
  // the Windows-only "<local>" token.
  return bypass.split(';').map((s) => s.trim()).filter((s) => s && s !== '<local>' && !s.includes('*'));
}

async function macEnable(host, port, bypass) {
  const services = await macActiveServices();
  if (!services.length) throw new Error('No active network service found');
  const domains = macBypassDomains(bypass);
  for (const service of services) {
    await run('networksetup', ['-setwebproxy', service, host, String(port)]);
    await run('networksetup', ['-setsecurewebproxy', service, host, String(port)]);
    if (domains.length) await run('networksetup', ['-setproxybypassdomains', service, ...domains]);
    await run('networksetup', ['-setwebproxystate', service, 'on']);
    await run('networksetup', ['-setsecurewebproxystate', service, 'on']);
  }
}

async function macDisable() {
  const services = await macActiveServices();
  for (const service of services) {
    await run('networksetup', ['-setwebproxystate', service, 'off']);
    await run('networksetup', ['-setsecurewebproxystate', service, 'off']);
  }
}

// ---- Linux: gsettings (GNOME and its derivatives -- Ubuntu's default) ----
// There's no single cross-desktop-environment standard the way Windows/macOS
// each have one; gsettings covers the GNOME family (the most common case,
// including stock Ubuntu). Other desktop environments (KDE, XFCE, ...) each
// have their own mechanism and aren't handled here -- enable()/disable() throw
// a clear, catchable error when gsettings itself isn't present so the caller
// can surface that instead of silently doing nothing.

async function gsettingsAvailable() {
  try { await run('gsettings', ['--version']); return true; } catch { return false; }
}

function linuxBypassList(bypass) {
  const list = bypass.split(';').map((s) => s.trim()).filter((s) => s && s !== '<local>');
  return `[${list.map((s) => `'${s.replace(/'/g, "\\'")}'`).join(',')}]`;
}

async function linuxEnable(host, port, bypass) {
  if (!(await gsettingsAvailable())) {
    // gsettings is the GNOME proxy store; KDE/XFCE/bare WMs don't have it.
    // Full Tunnel captures traffic at the OS level and needs no per-desktop
    // support, so point there rather than leaving a dead end.
    throw new Error('System proxy needs GNOME settings (gsettings), which this desktop does not provide. Switch to Full Tunnel mode to route all traffic instead.');
  }
  await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual']);
  for (const kind of ['http', 'https']) {
    await run('gsettings', ['set', `org.gnome.system.proxy.${kind}`, 'host', host]);
    await run('gsettings', ['set', `org.gnome.system.proxy.${kind}`, 'port', String(port)]);
  }
  await run('gsettings', ['set', 'org.gnome.system.proxy', 'ignore-hosts', linuxBypassList(bypass)]);
}

async function linuxDisable() {
  if (!(await gsettingsAvailable())) return; // nothing was ever turned on without it
  await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none']);
}

async function enable(host, port, bypass = DEFAULT_BYPASS) {
  if (process.platform === 'win32') return winEnable(host, port, bypass);
  if (process.platform === 'darwin') return macEnable(host, port, bypass);
  return linuxEnable(host, port, bypass);
}

async function disable() {
  if (process.platform === 'win32') return winDisable();
  if (process.platform === 'darwin') return macDisable();
  return linuxDisable();
}

module.exports = { enable, disable, buildBypass };
