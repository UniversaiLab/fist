'use strict';
// `electron .`, except it works when launched as root (e.g. `sudo npm run
// dev` to test Full Tunnel without the pkexec prompt). Chromium refuses to
// start as root unless its sandbox is disabled, so add --no-sandbox then.
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron'); // resolves to the binary's path
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const args = [...(isRoot ? ['--no-sandbox'] : []), path.join(__dirname, '..'), ...process.argv.slice(2)];

const child = spawn(electron, args, { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
