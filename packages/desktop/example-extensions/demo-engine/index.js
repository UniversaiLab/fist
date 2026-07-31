'use strict';
// Reference implementation of FIST's extension contract. Run standalone
// (spawned by electron/lib/extensionHost.cjs), speaking newline-delimited
// JSON over stdin/stdout:
//
//   host -> ext   {"id":N,"cmd":"parse","text":"..."}
//   ext  -> host  {"id":N,"ok":true,"profile":{"name":..,"address":..,"port":..}}
//                 {"id":N,"ok":false,"error":"..."}
//
//   host -> ext   {"id":N,"cmd":"connect","profile":{...}}
//   ext  -> host  {"id":N,"ok":true}
//   ext  -> host  {"event":"state","state":"connected"}     (any time, unsolicited)
//   ext  -> host  {"event":"log","message":"..."}           (any time, unsolicited)
//
//   host -> ext   {"id":N,"cmd":"disconnect"}
//   ext  -> host  {"id":N,"ok":true}
//
// This demo parses a fictitious demo-tcp://host:port#name link and, on
// connect, opens a real local TCP forwarder to that host:port -- proving
// the plumbing works end to end. A real extension wanting *full system*
// routing would do here whatever our own built-in engine does: stand up a
// TUN device and program OS routes, or run its own VPN binary -- that's
// entirely up to the extension, which is the point of this being a
// separate process rather than a fixed protocol list.

const net = require('net');
const readline = require('readline');

let server = null;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function emitState(state) {
  send({ event: 'state', state });
}

function emitLog(message) {
  send({ event: 'log', message });
}

function handleParse(id, text) {
  const m = String(text || '').match(/^demo-tcp:\/\/([^:/]+):(\d+)(?:#(.*))?$/);
  if (!m) {
    send({ id, ok: false, error: 'Not a demo-tcp:// link' });
    return;
  }
  const [, address, port, name] = m;
  send({ id, ok: true, profile: { name: name ? decodeURIComponent(name) : `${address}:${port}`, address, port: Number(port) } });
}

function handleConnect(id, profile) {
  if (server) {
    send({ id, ok: false, error: 'Already connected' });
    return;
  }
  server = net.createServer((client) => {
    const upstream = net.connect(profile.port, profile.address);
    client.pipe(upstream);
    upstream.pipe(client);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  server.on('error', (err) => {
    emitLog(`forward server error: ${err.message}`);
    emitState('disconnected');
    server = null;
  });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    emitLog(`forwarding 127.0.0.1:${port} -> ${profile.address}:${profile.port}`);
    emitState('connected');
    send({ id, ok: true });
  });
}

function handleDisconnect(id) {
  if (!server) {
    send({ id, ok: true });
    return;
  }
  server.close(() => {
    server = null;
    emitState('disconnected');
    send({ id, ok: true });
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.cmd === 'parse') handleParse(msg.id, msg.text);
  else if (msg.cmd === 'connect') handleConnect(msg.id, msg.profile);
  else if (msg.cmd === 'disconnect') handleDisconnect(msg.id);
  else if (msg.cmd === 'status') send({ id: msg.id, ok: true, state: server ? 'connected' : 'disconnected' });
});
