#!/usr/bin/env node
'use strict';
// Fetches the sing-box binary the app connects through.
//
// `bin/` is gitignored (the binaries are large and per-platform), so a fresh
// clone has no engine and every Connect fails with "The connection core
// (sing-box) file was not found". The README's answer was "build it yourself
// with Go", which is a lot to ask before the app will do anything at all.
//
// This downloads the official release for the current platform instead, and
// falls back to a Go build when a download isn't possible.
//
// A note on build tags: official releases ship with_clash_api but NOT
// with_v2ray_api. The app detects that at runtime (electron/lib/singboxCaps.cjs)
// and asks for whichever stats API the binary actually serves, so an official
// download is fully supported -- traffic counters included.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const VERSION = process.env.SINGBOX_VERSION || '1.13.14';
const REPO = 'SagerNet/sing-box';

// Mirrors are tried in order; the first is GitHub Releases, which is commonly
// blocked on exactly the networks this app exists to get around.
function downloadUrls(asset) {
  const custom = process.env.SINGBOX_MIRROR;
  const urls = [];
  if (custom) urls.push(`${custom.replace(/\/$/, '')}/${asset}`);
  urls.push(`https://github.com/${REPO}/releases/download/v${VERSION}/${asset}`);
  urls.push(`https://ghproxy.net/https://github.com/${REPO}/releases/download/v${VERSION}/${asset}`);
  return urls;
}

function platformAsset() {
  const goOs = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const goArch = { x64: 'amd64', arm64: 'arm64', ia32: '386' }[process.arch];
  if (!goOs || !goArch) return null;
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  return {
    name: `sing-box-${VERSION}-${goOs}-${goArch}.${ext}`,
    ext,
    binName: process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
  };
}

function destDir() {
  return path.join(__dirname, '..', 'bin', process.platform);
}

function destBin() {
  return path.join(destDir(), process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
}

function alreadyInstalled() {
  const bin = destBin();
  if (!fs.existsSync(bin)) return false;
  const res = spawnSync(bin, ['version'], { encoding: 'utf8', timeout: 10000 });
  return res.status === 0;
}

function curl(url, outFile) {
  // curl is present on macOS/Linux and modern Windows, and handles the
  // proxy env vars + redirects that a hand-rolled fetch would have to redo.
  const res = spawnSync('curl', ['-fsSL', '--max-time', '600', '-o', outFile, url], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error((res.stderr || 'download failed').trim().split('\n').pop());
}

// Extract just the sing-box binary out of the release archive.
function extract(archive, ext, tmpDir) {
  if (ext === 'zip') {
    // PowerShell is always available on the Windows runners/desktops we target.
    const res = spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${tmpDir}' -Force`], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error('could not unzip the release archive');
  } else {
    const res = spawnSync('tar', ['xzf', archive, '-C', tmpDir], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error('could not untar the release archive');
  }
  // The archive has a versioned top-level folder; find the binary inside it.
  const stack = [tmpDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'sing-box' || entry.name === 'sing-box.exe') return full;
    }
  }
  throw new Error('no sing-box binary inside the archive');
}

function tryGoBuild() {
  const go = spawnSync('go', ['version'], { encoding: 'utf8' });
  if (go.status !== 0) return false;
  console.log('  · building from source with Go (this takes a few minutes)…');
  // The tag list our README documents -- notably includes with_v2ray_api,
  // which official releases omit.
  const tags = 'with_quic,with_grpc,with_utls,with_clash_api,with_v2ray_api,with_wireguard,with_gvisor';
  const res = spawnSync('go', ['install', '-tags', tags, `github.com/${REPO}/cmd/sing-box@v${VERSION}`], {
    stdio: 'inherit',
    timeout: 20 * 60 * 1000,
  });
  if (res.status !== 0) return false;
  const gopath = (spawnSync('go', ['env', 'GOPATH'], { encoding: 'utf8' }).stdout || '').trim();
  const built = path.join(gopath, 'bin', process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
  if (!fs.existsSync(built)) return false;
  fs.mkdirSync(destDir(), { recursive: true });
  fs.copyFileSync(built, destBin());
  if (process.platform !== 'win32') fs.chmodSync(destBin(), 0o755);
  return true;
}

function main() {
  if (alreadyInstalled()) return; // silent fast path

  const asset = platformAsset();
  console.log(`[ensure-singbox] sing-box engine missing — installing v${VERSION}…`);

  if (asset) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'singbox-'));
    const archive = path.join(tmpDir, asset.name);
    const errors = [];
    for (const url of downloadUrls(asset.name)) {
      const host = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || url;
      process.stdout.write(`  · downloading from ${host}… `);
      try {
        curl(url, archive);
        const found = extract(archive, asset.ext, tmpDir);
        fs.mkdirSync(destDir(), { recursive: true });
        fs.copyFileSync(found, destBin());
        if (process.platform !== 'win32') fs.chmodSync(destBin(), 0o755);
        console.log('ok');
        fs.rmSync(tmpDir, { recursive: true, force: true });
        report();
        return;
      } catch (err) {
        console.log('failed');
        errors.push(`${host}: ${err.message}`.slice(0, 160));
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('  · all downloads failed, trying a local Go build…');
    if (tryGoBuild()) { report(); return; }
    fail(errors);
  }

  if (tryGoBuild()) { report(); return; }
  fail([`no prebuilt release for ${process.platform}/${process.arch}`]);
}

function report() {
  try {
    const out = execFileSync(destBin(), ['version'], { encoding: 'utf8', timeout: 10000 });
    const ver = (out.split('\n')[0] || '').trim();
    const tags = (out.split('\n').find((l) => l.startsWith('Tags:')) || '').trim();
    console.log(`[ensure-singbox] ${ver}`);
    if (!tags.includes('with_v2ray_api')) {
      // Not a problem -- the app detects this and uses the Clash API instead.
      console.log('[ensure-singbox] official build: traffic stats will use the Clash API.');
    }
  } catch { /* the binary works; version output is cosmetic */ }
}

function fail(errors) {
  console.error('\n[ensure-singbox] Could not install the sing-box engine.\n');
  console.error('Attempts:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  console.error('Options:');
  console.error('  1. Use a reachable mirror:');
  console.error('       export SINGBOX_MIRROR="https://your-mirror/path-to-release-assets"');
  console.error('  2. Install Go and re-run, to build from source instead.');
  console.error('  3. Download the release manually and place the binary at:');
  console.error(`       ${destBin()}`);
  console.error('');
  process.exit(1);
}

main();
