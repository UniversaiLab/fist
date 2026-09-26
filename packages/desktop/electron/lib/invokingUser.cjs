'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// When Full Tunnel elevates on Linux, the app ends up running as root via
// pkexec (or the user ran it under sudo). Root's HOME is /root, so without
// help the elevated window would read /root/.config -- an empty profile list
// -- and anything it wrote into the user's own config dir would come out
// root-owned, breaking the next normal launch.
//
// pkexec exports PKEXEC_UID and sudo exports SUDO_UID/SUDO_GID, so we can
// find the real user, keep using their data dir, and hand files back to them.

function passwdEntry(uid) {
  try {
    for (const line of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const f = line.split(':');
      if (f.length >= 7 && Number(f[2]) === uid) {
        return { uid, gid: Number(f[3]), home: f[5] };
      }
    }
  } catch { /* no passwd file -- fall through */ }
  return null;
}

// Returns { uid, gid, home } for the non-root user behind this root process,
// or null when we aren't root or weren't elevated from a regular user.
function invokingUser() {
  if (process.platform !== 'linux') return null;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;

  const raw = process.env.PKEXEC_UID || process.env.SUDO_UID;
  const uid = Number(raw);
  if (!raw || !Number.isInteger(uid) || uid <= 0) return null;

  const entry = passwdEntry(uid);
  if (!entry || !entry.home || entry.home === '/') return null;
  const gid = Number(process.env.SUDO_GID);
  if (process.env.SUDO_UID && Number.isInteger(gid) && gid > 0) entry.gid = gid;
  return entry;
}

function chownPaths(user, paths) {
  if (!user) return;
  for (const p of paths) {
    try { fs.lchownSync(p, user.uid, user.gid); } catch { /* missing is fine */ }
  }
}

// Recursively return everything under `dir` (and `dir` itself) to the user.
function chownTree(user, dir) {
  if (!user) return;
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    try { fs.lchownSync(p, user.uid, user.gid); } catch { /* best effort */ }
    if (st.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(p); } catch { /* unreadable */ }
      for (const n of names) walk(path.join(p, n));
    }
  };
  walk(dir);
}

// Chromium keeps writing into the data dir during its own shutdown, after
// our last JS hook has run, so an in-process chown always misses a few files.
// Instead start a tiny detached watcher now that waits for this process to be
// gone -- clean quit, Ctrl+C or crash alike -- and then fixes ownership.
// Values are passed as positional args, never interpolated into the script.
function chownTreeOnExit(user, dir) {
  if (!user) return;
  const script = 'while kill -0 "$1" 2>/dev/null; do sleep 0.5; done; sleep 1; chown -R "$2" "$3"';
  try {
    const child = spawn('/bin/sh', ['-c', script, 'fist-chown', String(process.pid), `${user.uid}:${user.gid}`, dir], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => { /* no /bin/sh -- the startup repair still runs next time */ });
    child.unref();
  } catch { /* best effort */ }
}

module.exports = { invokingUser, chownPaths, chownTree, chownTreeOnExit };
