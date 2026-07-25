'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class SingBoxProcess extends EventEmitter {
  constructor(singboxBinPath, workDir) {
    super();
    this.singboxBinPath = singboxBinPath;
    this.workDir = workDir;
    this.proc = null;
    this.configPath = path.join(workDir, 'active-config.json');
    this.logLines = [];
  }

  get isRunning() {
    return !!this.proc && this.proc.exitCode === null && !this.proc.killed;
  }

  start(config) {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        return reject(new Error('sing-box is already running'));
      }
      fs.mkdirSync(this.workDir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');

      this.logLines = [];
      const proc = spawn(this.singboxBinPath, ['run', '-c', this.configPath], {
        cwd: path.dirname(this.singboxBinPath),
        windowsHide: true,
      });
      this.proc = proc;

      // Guards against a stale/superseded process (one we've already moved on
      // from via a later start() call) still emitting events for this session.
      const isCurrent = () => this.proc === proc;

      let settled = false;
      const onData = (buf) => {
        if (!isCurrent()) return;
        const text = buf.toString('utf8');
        this.logLines.push(text);
        if (this.logLines.length > 500) this.logLines.shift();
        this.emit('log', text);
        if (!settled && /fatal/i.test(text)) {
          settled = true;
          reject(new Error(text.trim()));
          return;
        }
        // sing-box logs a line like "sing-box started (123.4ms)" once every
        // service (including TUN) is up.
        if (!settled && /sing-box started/i.test(text)) {
          settled = true;
          resolve();
        }
      };

      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);

      proc.on('error', (err) => {
        if (!isCurrent()) return;
        if (!settled) { settled = true; reject(err); }
        this.emit('exit', -1);
      });

      proc.on('exit', (code) => {
        if (!isCurrent()) return;
        this.emit('exit', code);
        if (!settled) {
          settled = true;
          if (code === 0 || code === null) resolve();
          else reject(new Error(`sing-box exited with code ${code}:\n${this.logLines.join('')}`));
        }
      });

      // Fallback in case the expected log line's wording changes between
      // sing-box versions -- mirrors the same safety net the xray-core process
      // manager used, so a startup that produced no fatal errors is still
      // treated as successful even if the "started" marker text drifts.
      setTimeout(() => {
        if (!settled) { settled = true; resolve(); }
      }, 1500);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.isRunning) return resolve();
      const proc = this.proc;
      const isAlive = () => proc.exitCode === null && !proc.killed;
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      proc.once('exit', finish);
      proc.kill();
      setTimeout(() => {
        if (isAlive()) proc.kill('SIGKILL');
        finish();
      }, 3000);
    });
  }
}

module.exports = { SingBoxProcess };
