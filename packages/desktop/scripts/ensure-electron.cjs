#!/usr/bin/env node
'use strict';
// Guarantees an actually-runnable Electron binary before `dev`/`start`/`dist`.
//
// The npm `electron` package is just a shim: its postinstall downloads the real
// binary and writes `path.txt` next to it. If that download is skipped
// (`--ignore-scripts`) or fails (blocked/throttled network -- GitHub Releases
// is a common casualty on restricted connections), the package still installs
// and every run dies with the famously unhelpful:
//
//   Error: Electron failed to install correctly, please delete
//   node_modules/electron and try installing again
//
// ...which is misleading, because reinstalling repeats the same failed
// download. This script diagnoses the real state and repairs it, falling back
// to a mirror when the default host isn't reachable.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Mirrors tried in order when the default download host fails. The npmmirror
// one is the usual escape hatch on networks where GitHub Releases is blocked.
const MIRRORS = [
  { name: 'default (github.com)', env: {} },
  { name: 'npmmirror.com', env: { ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/' } },
];

function electronDir() {
  try {
    return path.dirname(require.resolve('electron/package.json', { paths: [__dirname, process.cwd()] }));
  } catch {
    return null;
  }
}

// Resolve the binary the way electron/index.js does, without importing it
// (importing throws the unhelpful error we're trying to replace).
function binaryPath(dir) {
  const pathTxt = path.join(dir, 'path.txt');
  if (!fs.existsSync(pathTxt)) return null;
  const rel = fs.readFileSync(pathTxt, 'utf8').trim();
  if (!rel) return null;
  const abs = path.join(dir, 'dist', rel);
  return fs.existsSync(abs) ? abs : null;
}

function isHealthy(dir) {
  return Boolean(dir && binaryPath(dir));
}

function runInstall(dir, extraEnv, label) {
  process.stdout.write(`  · downloading Electron binary via ${label}… `);
  try {
    execFileSync(process.execPath, ['install.js'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
      timeout: 10 * 60 * 1000,
    });
  } catch (err) {
    const detail = (err.stderr || err.stdout || Buffer.from('')).toString().trim().split('\n').pop() || err.message;
    console.log('failed');
    return detail.slice(0, 160);
  }
  if (!isHealthy(dir)) {
    console.log('failed (no binary produced)');
    return 'install script completed but produced no binary';
  }
  console.log('ok');
  return null;
}

function main() {
  let dir = electronDir();

  if (isHealthy(dir)) return; // fast path: nothing to do, stay silent

  console.log('[ensure-electron] Electron binary is missing or incomplete — repairing…');

  // The shim package itself isn't there: let npm place it first, then the
  // download step below fills in the binary.
  if (!dir) {
    console.log('  · electron package not installed, running npm install…');
    try {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: path.join(__dirname, '..', '..', '..'),
        stdio: 'inherit',
        timeout: 15 * 60 * 1000,
      });
    } catch { /* fall through to the diagnosis below */ }
    dir = electronDir();
    if (!dir) {
      fail('The `electron` package could not be installed at all.', [
        'Check that `npm install` completes without errors at the repo root.',
      ]);
    }
    if (isHealthy(dir)) return;
  }

  const failures = [];
  for (const mirror of MIRRORS) {
    // Respect an explicitly configured mirror rather than overriding it.
    if (process.env.ELECTRON_MIRROR && Object.keys(mirror.env).length) continue;
    const err = runInstall(dir, mirror.env, process.env.ELECTRON_MIRROR ? `ELECTRON_MIRROR (${process.env.ELECTRON_MIRROR})` : mirror.name);
    if (!err) {
      console.log('[ensure-electron] Electron is ready.');
      return;
    }
    failures.push(`${mirror.name}: ${err}`);
  }

  fail('Could not download the Electron binary from any source.', [
    'Attempts:',
    ...failures.map((f) => `  - ${f}`),
    '',
    'This is almost always the network blocking the download, not a broken repo.',
    'Options:',
    '  1. Point at a reachable mirror, then re-run:',
    '       export ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"',
    '  2. If you already have the matching Electron zip, point at its folder:',
    '       export ELECTRON_CACHE="/path/to/folder/containing/the/zip"',
    '  3. Behind a proxy, export HTTPS_PROXY/HTTP_PROXY before installing.',
  ]);
}

function fail(headline, lines) {
  console.error(`\n[ensure-electron] ${headline}\n`);
  for (const l of lines) console.error(l);
  console.error('');
  process.exit(1);
}

main();
