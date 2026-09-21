'use strict';
// Which optional features the sing-box binary on this machine was actually
// compiled with.
//
// This matters because sing-box is built with Go build tags, and the official
// prebuilt releases include a DIFFERENT set than a source build using the tag
// list in our README. Most importantly, official releases ship WITHOUT
// `with_v2ray_api` -- and sing-box refuses to start at all ("v2ray api is not
// included in this build") if the config contains an `experimental.v2ray_api`
// block it can't serve. Emitting the wrong stats API is therefore not a
// degraded-features problem, it's a total failure to connect.
//
// Official releases do ship `with_clash_api`, which exposes equivalent traffic
// counters, so we detect what's available and generate a config the binary in
// front of us can actually run.

const { execFileSync } = require('child_process');

const cache = new Map();

function readTags(binPath) {
  try {
    const out = execFileSync(binPath, ['version'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('Tags:'));
    if (!line) return [];
    return line.slice('Tags:'.length).split(',').map((t) => t.trim()).filter(Boolean);
  } catch {
    // Binary missing/unrunnable -- callers handle that separately; here we
    // just report "no known capabilities".
    return [];
  }
}

function capabilities(binPath) {
  if (cache.has(binPath)) return cache.get(binPath);
  const tags = readTags(binPath);
  const caps = {
    tags,
    v2rayApi: tags.includes('with_v2ray_api'),
    clashApi: tags.includes('with_clash_api'),
    quic: tags.includes('with_quic'),
    utls: tags.includes('with_utls'),
    gvisor: tags.includes('with_gvisor'),
    wireguard: tags.includes('with_wireguard'),
    grpc: tags.includes('with_grpc'),
  };
  // Which traffic-stats API to ask for in the generated config. 'none' means
  // the binary supports neither, so we omit the block entirely rather than
  // hand it a config it will reject.
  caps.apiKind = caps.v2rayApi ? 'v2ray' : (caps.clashApi ? 'clash' : 'none');
  cache.set(binPath, caps);
  return caps;
}

// Called after (re)installing a binary so a stale answer isn't reused.
function clearCache() {
  cache.clear();
}

module.exports = { capabilities, clearCache };
