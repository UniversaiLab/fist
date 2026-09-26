'use strict';
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

// Full Tunnel on Linux without running the app as root.
//
// Relaunching the whole Electron app as root (the old approach) is fragile:
// root isn't authorised on the user's X/Wayland display, can't reach their
// D-Bus/IBus session, and the window comes up gray or not at all. Every
// mainstream Linux VPN client avoids that by keeping the GUI as the user and
// giving only the network core the rights it needs.
//
// sing-box needs CAP_NET_ADMIN to create the TUN device and install routes
// (plus NET_RAW/NET_BIND_SERVICE for ICMP and low ports). We install a
// root-owned copy with those file capabilities into a system directory --
// once, behind a single pkexec prompt -- and run that copy as the user.
// A system location matters: file capabilities are ignored on nosuid mounts
// (AppImage's FUSE mount, many home setups), and a root-owned binary can't be
// swapped out by other user processes to borrow its privileges.

const SYSTEM_DIR = '/usr/local/lib/fist';
const SYSTEM_BIN = `${SYSTEM_DIR}/sing-box`;
const CAPS = 'cap_net_admin,cap_net_raw,cap_net_bind_service+ep';

const hashCache = new Map(); // path -> { key, hash }

function fileHash(p) {
  const st = fs.statSync(p);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = hashCache.get(p);
  if (hit && hit.key === key) return hit.hash;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  hashCache.set(p, { key, hash });
  return hash;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
    });
  });
}

async function hasCaps(p) {
  for (const getcap of ['getcap', '/usr/sbin/getcap', '/sbin/getcap']) {
    const r = await run(getcap, [p]);
    if (r.err && r.err.code === 'ENOENT') continue;
    return /cap_net_admin/.test(r.stdout);
  }
  return false; // no getcap -- assume not; the install step will say what's missing
}

// True when the system copy exists, matches the bundled binary and still has
// its capabilities (an update or a stray chmod would have dropped them).
async function isReady(srcBin) {
  try {
    if (!fs.existsSync(SYSTEM_BIN)) return false;
    const st = fs.statSync(SYSTEM_BIN);
    if (st.uid !== 0) return false;
    if (fileHash(SYSTEM_BIN) !== fileHash(srcBin)) return false;
    return await hasCaps(SYSTEM_BIN);
  } catch {
    return false;
  }
}

// One pkexec prompt: copy the binary in as root and grant it capabilities.
// Paths go in as positional args ($1/$2), never interpolated into the script.
// Written to a temp name and renamed so a running copy is never truncated.
const INSTALL_SCRIPT = [
  'set -e',
  'mkdir -p "$(dirname "$2")"',
  'install -m 0755 -o root -g root "$1" "$2.new"',
  `setcap ${CAPS} "$2.new"`,
  'mv -f "$2.new" "$2"',
].join('; ');

function install(srcBin) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('pkexec', ['/bin/sh', '-c', INSTALL_SCRIPT, 'fist-install', srcBin, SYSTEM_BIN], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, reason: 'no-pkexec', detail: err.message });
      return;
    }
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ ok: false, reason: err.code === 'ENOENT' ? 'no-pkexec' : 'error', detail: err.message }));
    child.on('exit', (code) => {
      if (code === 0) return resolve({ ok: true });
      // Checked first: a missing setcap makes sh exit 127 too.
      if (/setcap: (command )?not found/i.test(stderr)) return resolve({ ok: false, reason: 'no-setcap', detail: stderr.trim() });
      // pkexec: 126 = the user dismissed the dialog, 127 = not authorised.
      if (code === 126 || code === 127) return resolve({ ok: false, reason: 'denied', detail: stderr.trim() });
      resolve({ ok: false, reason: 'error', detail: stderr.trim() || `exit code ${code}` });
    });
  });
}

function explain(result) {
  switch (result.reason) {
    case 'denied':
      return 'Full Tunnel needs a one-time permission to manage network routes. Approve the password prompt to continue.';
    case 'no-pkexec':
      return 'Full Tunnel needs a one-time permission, but pkexec (PolicyKit) is not installed. Install it with: sudo apt install pkexec';
    case 'no-setcap':
      return 'Full Tunnel needs the setcap tool. Install it with: sudo apt install libcap2-bin';
    default:
      return `Could not set up Full Tunnel permissions: ${result.detail || 'unknown error'}`;
  }
}

// Returns { ok: true, bin } with the binary to run, or { ok: false, message }.
// `onPrompt` runs just before the password dialog appears.
async function ensure(srcBin, { onPrompt } = {}) {
  try {
    fs.accessSync('/dev/net/tun', fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    return { ok: false, message: 'Full Tunnel needs read/write access to /dev/net/tun, which is missing on this system. Load the tun module (sudo modprobe tun) and try again.' };
  }
  if (await isReady(srcBin)) return { ok: true, bin: SYSTEM_BIN };
  if (onPrompt) onPrompt();
  const result = await install(srcBin);
  if (!result.ok) return { ok: false, message: explain(result) };
  if (!(await isReady(srcBin))) {
    return { ok: false, message: 'Full Tunnel permissions were installed but could not be verified. Try connecting again.' };
  }
  return { ok: true, bin: SYSTEM_BIN };
}

module.exports = { ensure, isReady, SYSTEM_BIN };
