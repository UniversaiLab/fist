'use strict';
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- Windows ----
// "net session" only succeeds when the current process holds admin rights --
// a standard, dependency-free way to check elevation on Windows.
function winIsElevated() {
  return new Promise((resolve) => {
    execFile('net', ['session'], { windowsHide: true }, (err) => resolve(!err));
  });
}

// Launches a new elevated instance of this same app via UAC (PowerShell's
// Start-Process -Verb RunAs is the standard trick; there's no direct Win32
// "runas" binding available from plain Node/Electron). Resolves true and
// exits the current, unelevated process only once Windows confirms the
// elevated instance actually launched. If the user cancels the UAC prompt
// (or it fails for any other reason), Start-Process throws immediately and
// we resolve false instead -- callers must fall back to something visible
// rather than assuming the relaunch always succeeds.
function winRelaunchElevated(app) {
  const exePath = process.execPath;
  const appPath = app.isPackaged ? null : app.getAppPath();

  const quoted = (s) => `'${s.replace(/'/g, "''")}'`;
  // Start-Process joins -ArgumentList array elements into a single lpParameters
  // string for ShellExecute without quoting them, so a path containing spaces
  // (like this project's own directory) gets split into multiple argv entries
  // by the child process unless we embed literal double quotes ourselves.
  const command = appPath
    ? `Start-Process -FilePath ${quoted(exePath)} -ArgumentList ${quoted(`"${appPath}"`)} -Verb RunAs`
    : `Start-Process -FilePath ${quoted(exePath)} -Verb RunAs`;

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command],
      { windowsHide: true },
      (err) => {
        if (err) {
          resolve(false);
          return;
        }
        app.exit(0);
        resolve(true);
      }
    );
  });
}

// ---- macOS ----
// Relaunches via `do shell script ... with administrator privileges`, which
// is AppleScript's standard way to trigger the native GUI password prompt
// (the same one macOS itself uses). The relaunch command is written to a
// small temp script (backgrounded with `&`) rather than embedded inline in
// the AppleScript string, since nesting this app's own path -- which can
// contain spaces or quotes -- inside two layers of shell/AppleScript quoting
// is exactly the kind of thing that silently breaks.
function macIsElevated() {
  return Promise.resolve(typeof process.getuid === 'function' && process.getuid() === 0);
}

function macRelaunchElevated(app) {
  const exePath = process.execPath;
  const appPath = app.isPackaged ? null : app.getAppPath();
  const tmpScript = path.join(os.tmpdir(), `soulconnection-relaunch-${Date.now()}.sh`);
  const relaunchCmd = appPath ? `"${exePath}" "${appPath}"` : `"${exePath}"`;
  fs.writeFileSync(tmpScript, `#!/bin/sh\nexec ${relaunchCmd} >/dev/null 2>&1 &\n`, { mode: 0o755 });

  return new Promise((resolve) => {
    execFile('osascript', ['-e', `do shell script "${tmpScript}" with administrator privileges`], (err) => {
      try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
      if (err) {
        resolve(false);
        return;
      }
      app.exit(0);
      resolve(true);
    });
  });
}

// ---- Linux ----
// pkexec (PolicyKit) is the closest cross-desktop equivalent of UAC/the macOS
// prompt: a native GUI password dialog on GNOME/KDE/most distros with
// PolicyKit installed.
//
// Two things make a naive `spawn('pkexec', [exe])` fail badly here:
//
//  1. pkexec deliberately sanitises the environment, so the elevated process
//     inherits no DISPLAY/XAUTHORITY and a GUI app simply cannot start. We
//     therefore run it via `env` and re-supply exactly the variables needed to
//     reach the user's X/Wayland session.
//  2. pkexec stays attached to whatever it launches, so we can't wait for it
//     to exit to learn whether it worked. Exiting ourselves the moment pkexec
//     *spawns* (what this used to do) means a cancelled prompt, a missing
//     PolicyKit agent, or an elevated process that dies on startup all leave
//     the user with no app at all -- it just vanishes.
//
// So the elevated instance is asked to touch a ready-file, and we only exit
// once we've actually seen it. If pkexec exits first, or nothing appears in
// time, we report failure and the caller keeps the existing window open.
function linuxIsElevated() {
  return Promise.resolve(typeof process.getuid === 'function' && process.getuid() === 0);
}

const READY_FLAG = '--fist-elevated-ready=';
const READY_TIMEOUT_MS = 120000; // generous: the user has to type a password
const READY_POLL_MS = 250;

// Session variables the elevated GUI process needs; anything unset is skipped
// rather than passed through as an empty value.
function sessionEnvArgs() {
  return ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']
    .filter((k) => process.env[k])
    .map((k) => `${k}=${process.env[k]}`);
}

function linuxRelaunchElevated(app) {
  const exePath = process.execPath;
  const appPath = app.isPackaged ? null : app.getAppPath();
  const readyFile = path.join(os.tmpdir(), `fist-elevated-${Date.now()}-${process.pid}`);

  const target = appPath ? [exePath, appPath] : [exePath];
  const args = ['env', ...sessionEnvArgs(), ...target, `${READY_FLAG}${readyFile}`];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('pkexec', args, { detached: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      try { fs.unlinkSync(readyFile); } catch { /* may not exist */ }
      if (ok) {
        child.unref();
        app.exit(0);
      }
      resolve(ok);
    };

    // The elevated instance is up and has a window coming -- only now is it
    // safe for this process to go away.
    const poll = setInterval(() => {
      if (fs.existsSync(readyFile)) finish(true);
    }, READY_POLL_MS);

    const timer = setTimeout(() => finish(false), READY_TIMEOUT_MS);

    child.once('error', () => finish(false));
    // pkexec exits non-zero when the prompt is dismissed or policy denies it.
    // If it exits before the ready-file shows up, elevation did not happen.
    child.once('exit', () => {
      if (!fs.existsSync(readyFile)) finish(false);
    });
  });
}

// Called by the elevated instance at startup to tell its parent it's alive.
function signalElevatedReady(argv) {
  const arg = (argv || []).find((a) => a.startsWith(READY_FLAG));
  if (!arg) return;
  try { fs.writeFileSync(arg.slice(READY_FLAG.length), 'ready'); } catch { /* parent will time out */ }
}

function isElevated() {
  if (process.platform === 'win32') return winIsElevated();
  if (process.platform === 'darwin') return macIsElevated();
  return linuxIsElevated();
}

function relaunchElevated(app) {
  if (process.platform === 'win32') return winRelaunchElevated(app);
  if (process.platform === 'darwin') return macRelaunchElevated(app);
  return linuxRelaunchElevated(app);
}

module.exports = { isElevated, relaunchElevated, signalElevatedReady };
