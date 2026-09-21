'use strict';
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = path.join(__dirname, 'proto', 'v2ray-stats.proto');
let statsProto = null;

function loadProto() {
  if (statsProto) return statsProto;
  const def = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  // sing-box's experimental.v2ray_api exposes this under the real v2ray-core
  // service name for interop -- see electron/lib/proto/v2ray-stats.proto.
  statsProto = grpc.loadPackageDefinition(def).v2ray.core.app.stats.command;
  return statsProto;
}

class StatsClient {
  constructor(apiPort) {
    const proto = loadProto();
    this.client = new proto.StatsService(
      `127.0.0.1:${apiPort}`,
      grpc.credentials.createInsecure(),
      { 'grpc.max_receive_message_length': 8 * 1024 * 1024 }
    );
  }

  // Returns cumulative { uplink, downlink } byte counts for the given
  // outbound tag since the process started (reset=false -- we compute our
  // own deltas locally rather than consuming Xray's counters).
  queryOutboundTraffic(tag, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + timeoutMs);
      this.client.QueryStats(
        { patterns: [`outbound>>>${tag}>>>traffic>>>`], reset: false },
        { deadline },
        (err, res) => {
          if (err) return reject(err);
          let uplink = 0;
          let downlink = 0;
          for (const stat of res.stat || []) {
            if (stat.name.endsWith('>>>uplink')) uplink = Number(stat.value) || 0;
            else if (stat.name.endsWith('>>>downlink')) downlink = Number(stat.value) || 0;
          }
          resolve({ uplink, downlink });
        }
      );
    });
  }

  close() {
    try { this.client.close(); } catch { /* ignore */ }
  }
}

// Same contract as StatsClient, backed by sing-box's Clash-compatible
// controller instead of the v2ray API. Official sing-box releases ship
// with_clash_api but NOT with_v2ray_api, so this is the path that keeps
// traffic counters working on a stock downloaded binary.
//
// /connections reports process-wide cumulative `uploadTotal`/`downloadTotal`
// rather than per-outbound counters. In this app everything tunnelled goes
// out through the single 'proxy' outbound, so the totals track it closely;
// the caller computes deltas either way, so the units and semantics match.
class ClashStatsClient {
  constructor(apiPort) {
    this.base = `http://127.0.0.1:${apiPort}`;
    this.closed = false;
  }

  async queryOutboundTraffic(_tag, timeoutMs = 3000) {
    if (this.closed) throw new Error('stats client closed');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}/connections`, { signal: controller.signal });
      if (!res.ok) throw new Error(`clash api responded ${res.status}`);
      const body = await res.json();
      return {
        uplink: Number(body.uploadTotal) || 0,
        downlink: Number(body.downloadTotal) || 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  close() {
    this.closed = true;
  }
}

// Picks the client matching what the running binary actually serves.
function createStatsClient(apiPort, apiKind) {
  if (apiKind === 'clash') return new ClashStatsClient(apiPort);
  if (apiKind === 'none') return null;
  return new StatsClient(apiPort);
}

module.exports = { StatsClient, ClashStatsClient, createStatsClient };
