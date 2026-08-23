'use strict';
const fs = require('fs');
const path = require('path');

const SAVE_DEBOUNCE_MS = 200;

// Crash-safe persistence. Everything the app owns (profiles, subscriptions,
// settings) lives in this one JSON file, so a write interrupted by a crash,
// a power cut, or the OS killing us mid-quit must never be able to leave a
// truncated file behind -- that would silently lose every server the user
// ever added.
//
// The write is therefore never done in place. Instead:
//   1. serialize to <file>.tmp and fsync it, so the bytes are really on disk
//   2. snapshot the current good file to <file>.bak
//   3. rename(tmp -> file), which is atomic on both POSIX and Windows
// A crash at any point leaves either the old file or the new one intact,
// never a half-written one.
//
// On load, an unreadable/corrupt primary file falls back to the .bak, and the
// corrupt one is moved aside to <file>.corrupt-<ts> rather than deleted, so a
// user who hits this can still be helped to recover by hand.

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  // A JSON file that parses to a non-object (null, an array, a bare number)
  // isn't a store we can merge defaults into -- treat it as corrupt.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('store root is not an object');
  }
  return parsed;
}

class JsonStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.tmpPath = `${filePath}.tmp`;
    this.bakPath = `${filePath}.bak`;
    this.data = { ...defaults };
    this._saveTimer = null;
    this._writing = false;
    this._dirty = false;
    this._load();
  }

  _load() {
    try {
      this.data = { ...this.data, ...readJson(this.filePath) };
      return;
    } catch (err) {
      // ENOENT just means first run -- nothing to recover, keep defaults.
      if (err && err.code === 'ENOENT') return;
      console.error('Primary store unreadable, trying backup:', err.message);
      this._quarantine();
    }

    try {
      this.data = { ...this.data, ...readJson(this.bakPath) };
      console.error('Recovered store from backup:', this.bakPath);
      // Promote the recovered data back to the primary path immediately, so
      // the next crash doesn't have to walk this path again.
      this._dirty = true;
      this.flush();
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        console.error('Backup store also unreadable, starting fresh:', err.message);
      }
    }
  }

  // Move a corrupt primary file aside instead of overwriting it, so it's still
  // available for manual recovery.
  _quarantine() {
    try {
      fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    } catch { /* nothing more we can do */ }
  }

  // The actual durable write, shared by the debounced and synchronous paths.
  // Synchronous throughout: the atomicity guarantee depends on the ordering of
  // these steps, and it has to hold on the quit path too, where the process
  // may not live long enough to run async callbacks.
  _persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const json = JSON.stringify(this.data);

    // 1. Write the new contents to a temp file and force it to disk. Without
    // the fsync, rename() can land while the data blocks are still buffered,
    // which on a power cut yields an atomically-renamed *empty* file.
    const fd = fs.openSync(this.tmpPath, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // 2. Keep the last known-good file as the backup. copyFile (not rename)
    // so the primary stays in place until the atomic swap below.
    try {
      fs.copyFileSync(this.filePath, this.bakPath);
    } catch (err) {
      // ENOENT = first ever write, nothing to back up yet.
      if (err && err.code !== 'ENOENT') console.error('Failed to snapshot store backup:', err.message);
    }

    // 3. Atomic swap. After this line either the whole new file is visible or
    // the whole old one still is.
    fs.renameSync(this.tmpPath, this.filePath);
  }

  _writeNow() {
    if (this._writing) {
      // A write is already in flight; try again shortly rather than risk
      // two overlapping writes to the same file.
      this._saveTimer = setTimeout(() => { this._saveTimer = null; this._writeNow(); }, SAVE_DEBOUNCE_MS);
      return;
    }
    this._dirty = false;
    this._writing = true;
    try {
      this._persist();
    } catch (err) {
      console.error('Failed to persist store:', err.message);
      // Leave the data marked dirty so the next set() retries the write
      // rather than silently dropping the change.
      this._dirty = true;
    } finally {
      this._writing = false;
    }
  }

  get(key, fallback) {
    return key in this.data ? this.data[key] : fallback;
  }

  set(key, value) {
    // In-memory state updates immediately (so get() is always consistent);
    // the disk write is debounced so a burst of set() calls (e.g. connect()
    // updating activeProfileId/mode/lastUsedAt back-to-back) costs one write
    // instead of N full-file rewrites.
    this.data[key] = value;
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._writeNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // Immediate write -- call right before the app quits so a pending debounced
  // save is never lost.
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this._dirty) return;
    this._dirty = false;
    try {
      this._persist();
    } catch (err) {
      console.error('Failed to flush store:', err.message);
    }
  }
}

module.exports = { JsonStore };
