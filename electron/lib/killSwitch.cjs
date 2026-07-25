'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// ---- Windows: Windows Firewall (WFP) via netsh ----
// Rule precedence is by specificity, not insertion order or allow-vs-block: a
// rule that names a program or remote IP is more specific than the bare
// "block everything" rule below, so the two allow rules win even though the
// block rule also matches. That's what lets a single generic block-all rule
// co-exist with "but let sing-box's own process and loopback through" without
// any priority/weight flags.
const WIN_RULE_BLOCK = 'SoulConnectionKillSwitch-Block';
const WIN_RULE_ALLOW_ENGINE = 'SoulConnectionKillSwitch-AllowEngine';
const WIN_RULE_ALLOW_LOOPBACK = 'SoulConnectionKillSwitch-AllowLoopback';
const WIN_ALL_RULES = [WIN_RULE_BLOCK, WIN_RULE_ALLOW_ENGINE, WIN_RULE_ALLOW_LOOPBACK];

async function winDeleteRule(name) {
  try {
    await run('netsh.exe', ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`]);
  } catch {
    // Rule may simply not exist -- deleting is always best-effort cleanup.
  }
}

async function winDisable() {
  for (const name of WIN_ALL_RULES) await winDeleteRule(name);
}

// Adds the two allow rules first and the block-all rule last, so that if
// anything throws partway through (most likely: not actually elevated, which
// fails every one of these identically), we abort before the dangerous
// block-all rule ever lands and roll back whatever partial state resulted.
async function winEnable(enginePath) {
  await winDisable(); // idempotent: clear any stale rules from a previous run first
  try {
    await run('netsh.exe', ['advfirewall', 'firewall', 'add', 'rule', `name=${WIN_RULE_ALLOW_LOOPBACK}`, 'dir=out', 'action=allow', 'remoteip=127.0.0.1', 'enable=yes', 'profile=any']);
    await run('netsh.exe', ['advfirewall', 'firewall', 'add', 'rule', `name=${WIN_RULE_ALLOW_ENGINE}`, 'dir=out', 'action=allow', `program=${enginePath}`, 'enable=yes', 'profile=any']);
    await run('netsh.exe', ['advfirewall', 'firewall', 'add', 'rule', `name=${WIN_RULE_BLOCK}`, 'dir=out', 'action=block', 'enable=yes', 'profile=any']);
  } catch (err) {
    await winDisable();
    throw err;
  }
}

async function winIsActive() {
  try {
    const out = await run('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${WIN_RULE_BLOCK}`]);
    return !/no rules match/i.test(out);
  } catch {
    return false;
  }
}

// ---- macOS: pf, via a dedicated named anchor loaded outside /etc/pf.conf ----
// pf has no per-process/per-binary matching (unlike Windows Firewall's
// `program=`), so instead of "block everything except this .exe" the rule
// shape here is "block everything except loopback and the tunnel's own
// remote endpoint" -- which is why enable() takes the active profile's
// server address/port rather than the engine binary path.
const MAC_ANCHOR = 'soulconnection/killswitch';

function macRules(remote) {
  const dest = `${remote.host}${/^\d+$/.test(String(remote.port)) ? ` port ${remote.port}` : ''}`;
  return [
    'block drop out quick on ! lo0 all',
    'pass out quick on lo0 all',
    `pass out quick proto {tcp, udp} to ${dest}`,
  ].join('\n') + '\n';
}

async function macEnable(remote) {
  if (!remote || !remote.host || !remote.port) {
    throw new Error('برای فعال‌سازی Kill Switch روی macOS باید سروری متصل باشد');
  }
  const tmpFile = path.join(os.tmpdir(), `soulconnection-killswitch-${Date.now()}.pf`);
  fs.writeFileSync(tmpFile, macRules(remote), 'utf8');
  try {
    await run('pfctl', ['-a', MAC_ANCHOR, '-f', tmpFile]);
    try {
      await run('pfctl', ['-e']); // best-effort: fails harmlessly if pf is already enabled
    } catch { /* already enabled */ }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function macDisable() {
  try {
    // Flush only our own anchor's rules -- leaves pf's overall enabled/disabled
    // state untouched, same as the Windows path never toggles the firewall
    // itself, only its own named rules.
    await run('pfctl', ['-a', MAC_ANCHOR, '-F', 'all']);
  } catch {
    // No anchor loaded -- nothing to clean up.
  }
}

async function macIsActive() {
  try {
    const out = await run('pfctl', ['-a', MAC_ANCHOR, '-s', 'rules']);
    return /block/i.test(out);
  } catch {
    return false;
  }
}

// ---- Linux: nftables ----
// Same "block everything except loopback and the tunnel's own remote
// endpoint" shape as macOS, in its own table so it can be dropped atomically
// without touching any of the system's other nftables rules.
const LINUX_TABLE = 'soulconnection_killswitch';

function linuxRuleset(remote) {
  const family = /:/.test(remote.host) ? 'ip6' : 'ip'; // best-effort: literal IPv6 vs IPv4/hostname
  const daddrLine = /^[\d.:a-fA-F]+$/.test(remote.host) ? `  ${family} daddr ${remote.host} accept\n` : '';
  return `table inet ${LINUX_TABLE} {
  chain killswitch {
    type filter hook output priority 0; policy accept;
    oif lo accept
${daddrLine}    drop
  }
}
`;
}

async function linuxEnable(remote) {
  if (!remote || !remote.host || !remote.port) {
    throw new Error('برای فعال‌سازی Kill Switch روی لینوکس باید سروری متصل باشد');
  }
  await linuxDisable(); // idempotent: clear any stale table from a previous run first
  const tmpFile = path.join(os.tmpdir(), `soulconnection-killswitch-${Date.now()}.nft`);
  fs.writeFileSync(tmpFile, linuxRuleset(remote), 'utf8');
  try {
    await run('nft', ['-f', tmpFile]);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function linuxDisable() {
  try {
    await run('nft', ['delete', 'table', 'inet', LINUX_TABLE]);
  } catch {
    // Table doesn't exist -- nothing to clean up.
  }
}

async function linuxIsActive() {
  try {
    await run('nft', ['list', 'table', 'inet', LINUX_TABLE]);
    return true;
  } catch {
    return false;
  }
}

// `remote` ({host, port}) is only required on macOS/Linux -- Windows Firewall
// can match the engine's own process directly and ignores it.
async function enable(enginePath, remote) {
  if (process.platform === 'win32') return winEnable(enginePath);
  if (process.platform === 'darwin') return macEnable(remote);
  return linuxEnable(remote);
}

async function disable() {
  if (process.platform === 'win32') return winDisable();
  if (process.platform === 'darwin') return macDisable();
  return linuxDisable();
}

async function isActive() {
  if (process.platform === 'win32') return winIsActive();
  if (process.platform === 'darwin') return macIsActive();
  return linuxIsActive();
}

module.exports = { enable, disable, isActive };
