'use strict';
// Real plugin system for configs we don't know how to handle: an extension
// is a small folder (extension.json manifest + an entry script) that the
// user installs locally. Each extension runs as its own OS child process --
// that's the actual security boundary here, not a JS sandbox. An installed
// extension has the same trust level as any other program you'd run on your
// machine: it can do anything Node can do (spawn its own binaries, open its
// own TUN device, whatever it needs to fully own routing for its protocol).
// We don't attempt to sandbox what it does *inside* that process; we only
// isolate it from *this* process (crashes don't take down the app, and it
// only talks to us through the JSON-line protocol below).
//
// Wire protocol (newline-delimited JSON over the child's stdin/stdout):
//   host -> ext   {"id":1,"cmd":"parse","text":"<raw config>"}
//   ext  -> host  {"id":1,"ok":true,"profile":{"name":..,"address":..,"port":..}}
//                 {"id":1,"ok":false,"error":"..."}
//   host -> ext   {"id":2,"cmd":"connect","profile":{...}}
//   ext  -> host  {"id":2,"ok":true}   (then, any time later, unsolicited:)
//                 {"event":"state","state":"connected"|"disconnected"}
//                 {"event":"log","message":"..."}
//   host -> ext   {"id":3,"cmd":"disconnect"}
//   ext  -> host  {"id":3,"ok":true}

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const REQUEST_TIMEOUT_MS = 8000;

function extensionsDir(userDataDir) {
  return path.join(userDataDir, 'extensions');
}

function readManifest(dir) {
  const manifestPath = path.join(dir, 'extension.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.id || !manifest.name || !manifest.entry) return null;
    return { ...manifest, dir };
  } catch {
    return null;
  }
}

function listExtensions(userDataDir) {
  const dir = extensionsDir(userDataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readManifest(path.join(dir, d.name)))
    .filter(Boolean);
}

function getExtension(userDataDir, id) {
  return listExtensions(userDataDir).find((e) => e.id === id) || null;
}

// Copies a folder the user picked (must contain extension.json) into our
// managed extensions directory. Deliberately shallow validation -- we check
// the manifest shape, not the entry script's contents, since we can't
// meaningfully vet arbitrary code; the install action itself is the user's
// trust decision, same as installing any other local program.
function installExtension(userDataDir, sourceDir) {
  const manifest = readManifest(sourceDir);
  if (!manifest) throw new Error('That folder does not contain a valid extension.json');
  const entryPath = path.join(sourceDir, manifest.entry);
  if (!fs.existsSync(entryPath)) throw new Error(`Entry script "${manifest.entry}" not found in that folder`);

  const destDir = path.join(extensionsDir(userDataDir), manifest.id);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(sourceDir, destDir, { recursive: true });
  return readManifest(destDir);
}

function removeExtension(userDataDir, id) {
  const dir = path.join(extensionsDir(userDataDir), id);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Short-lived: spawns the extension, asks it to parse one piece of text,
// takes the first answer, then kills it. Used when the user is adding a
// config and has picked "run this with <extension>".
function parseWithExtension(userDataDir, extensionId, text) {
  const manifest = getExtension(userDataDir, extensionId);
  if (!manifest) throw new Error('Extension not found');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(manifest.dir, manifest.entry)], {
      cwd: manifest.dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Extension "${manifest.name}" timed out while parsing`));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1 && !settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          if (msg.ok) resolve(msg.profile || {});
          else reject(new Error(msg.error || 'Extension could not parse this config'));
        }
      }
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.stdin.write(JSON.stringify({ id: 1, cmd: 'parse', text }) + '\n');
  });
}

// Long-lived engine: same start/stop/on('exit') shape as SingBoxProcess, so
// main.cjs can treat "the active engine" uniformly regardless of which one
// is actually running a given connection.
class ExtensionEngine extends EventEmitter {
  constructor(userDataDir, extensionId) {
    super();
    this.userDataDir = userDataDir;
    this.extensionId = extensionId;
    this.child = null;
    this.nextReqId = 100;
    this.pending = new Map();
  }

  _send(cmd, extra = {}) {
    const id = this.nextReqId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension timed out responding to "${cmd}"`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, cmd, ...extra }) + '\n');
    });
  }

  async start(profile) {
    const manifest = getExtension(this.userDataDir, this.extensionId);
    if (!manifest) throw new Error('Extension not found');

    this.child = spawn(process.execPath, [path.join(manifest.dir, manifest.entry)], {
      cwd: manifest.dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });

    let buffer = '';
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.event === 'state') {
          this.emit(msg.state === 'connected' ? 'connected' : 'disconnected');
        } else if (msg.event === 'log') {
          this.emit('log', msg.message);
        } else if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          if (msg.ok) resolve(msg);
          else reject(new Error(msg.error || 'Extension reported an error'));
        }
      }
    });
    this.child.on('exit', () => { this.emit('exit'); });
    this.child.on('error', (err) => { this.emit('log', `[extension] ${err.message}`); });

    await this._send('connect', { profile });
  }

  async stop() {
    if (!this.child) return;
    try {
      await Promise.race([
        this._send('disconnect'),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      // best effort -- fall through to a hard kill either way
    }
    this.child.kill();
    this.child = null;
  }
}

module.exports = {
  listExtensions, getExtension, installExtension, removeExtension,
  parseWithExtension, ExtensionEngine,
};
