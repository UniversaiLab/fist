# FIST · 1819

A cross-platform (Windows / macOS / Linux) desktop VPN/proxy client built on
[sing-box](https://sing-box.sagernet.org/), with a plug-and-play extension
system for protocols it doesn't natively support, and a client-side config
marketplace prototype.

---

## What FIST does

- **Connects through sing-box** — a single Go binary handles every native
  protocol below, plus a system-wide TUN mode for full-tunnel routing.
- **One connect button, two routing modes** — *System Proxy* (a local
  SOCKS5/HTTP proxy you point apps at, or let FIST set as the OS system proxy)
  and *Full Tunnel* (a TUN device that routes all system traffic; requires
  administrator/root, since installing routes and a virtual network
  interface needs elevated privileges on every OS).
- **Plug-and-play for anything else** — if a pasted config isn't a protocol
  FIST recognizes, you choose an engine to run it: a raw sing-box outbound
  JSON passthrough, or an installed extension (its own OS process) that can
  take full control of connecting and routing for that config. See
  [Engines / extensions](#engines--extensions) below.
- **SSH jump/bastion chains** — connect through one or more intermediate SSH
  hosts before reaching the real destination, same idea as `ssh -J
  hop1,hop2,...` or `sshuttle --ssh-cmd 'ssh -J ...'`. Build a chain from
  scratch in the Custom tab (add/remove hop rows, password or private-key
  auth per hop), or paste a real `ssh -J ...` / `sshuttle ...` command
  line to pull out the hosts automatically — those never carry passwords,
  so fill in each hop's password/key afterward via Edit.
- **Kill Switch** — blocks all outbound traffic if the tunnel drops
  unexpectedly, until you reconnect or turn it off.
- **Censorship resistance** — layered evasion built on sing-box, configurable
  under Settings → Network. See [Surviving hostile networks](#surviving-hostile-networks).
- **Subscriptions** — import a subscription URL, auto-update on an interval,
  see per-subscription data-usage/expiry.
- **`.fist` bundles** — a compact, dependency-free export/import format for
  moving many configs at once (see `packages/core-logic/fistFormat.js`).
- **NapsternetV imports** — plain-text `.npvt`/`.npv4`/`.inpv` exports are
  read directly (single config, array, or wrapped under a
  `configs`/`profiles` key, as well as plain link lists). NapsternetV's
  *encrypted* container (files beginning with an `NPVT1` magic line) is
  detected and reported as such: its key lives inside the NapsternetV app,
  so it cannot be decrypted here — re-export the server as an `npvt-ssh://`
  link instead.
- **Server Finder** — batch ping/real-connect/speed tests across your
  configs with a live dashboard, to find the fastest one.
- **Config marketplace** — buy/sell configs, with a backend
  (`packages/marketplace-server`) providing real accounts, listings,
  purchases, and a **provider rating system** (1-5 stars, one per buyer per
  listing, gated on having actually purchased it, aggregated per listing and
  per creator).
- **Crypto payments** — real on-chain settlement for config and subscription
  purchases via [ethers](https://docs.ethers.org/). Each invoice derives its
  own receiving address from an HD wallet, is quoted in USD and settled in
  the configured asset, and only releases the config once the payment has
  the required confirmations. The platform margin on each sale is
  configurable (`PLATFORM_FEE_BPS`, default 20%). See
  [Crypto payments](#crypto-payments) below.

## Supported protocols

| Protocol | How it runs |
|---|---|
| VLESS (incl. Reality) | native sing-box outbound |
| VMess | native sing-box outbound |
| Trojan | native sing-box outbound |
| Shadowsocks | native sing-box outbound |
| Hysteria2 (`hysteria2://`, `hy2://`) | native sing-box outbound |
| WireGuard (`.conf` import) | native sing-box endpoint |
| SSH (`npvt-ssh://` links, pasted SSH JSON, plain-text NapsternetV `.npvt`/`.npv4`/`.inpv` exports, or an `ssh -J`/`sshuttle` jump-chain command) | native sing-box `ssh` outbound, chained through jump/bastion hosts via `detour` when present |
| MTProto (`tg://proxy`, `mtproto://`) | parsed/stored/QR-exportable only — Telegram proxies aren't a system tunnel, so these open directly in Telegram instead of connecting through FIST |
| SOCKS5 / HTTP upstream proxies (incl. username/password) | native sing-box `socks` / `http` outbound |
| Full **Xray / V2Ray JSON configs** (`{"outbounds":[…]}` — v2rayNG exports, panel output, decrypted NapsternetV configs) | the `proxy` outbound is extracted and mapped onto the matching native outbound; the file's own inbounds/DNS/routing are ignored in favour of the app's settings |
| Anything else sing-box supports natively (TUIC, Naive, ShadowTLS, AnyTLS, …) | paste sing-box's own outbound JSON as a **raw outbound** |
| Truly unknown formats | an installed **extension** you choose per-config |

## Surviving hostile networks

Aggressive filtering doesn't just block IPs — it fingerprints TLS handshakes,
probes servers to see what answers, throttles UDP, and poisons DNS. FIST
exposes sing-box's countermeasures for each of those, all off-by-default
except the free one (`utlsFingerprint`), so nothing changes on a normal
network unless you ask for it.

| Layer | Setting | What it defeats |
|---|---|---|
| **TLS fingerprint (uTLS)** | `utlsFingerprint` (default `chrome`) | JA3/JA4 heuristics that flag a stock Go TLS handshake as non-browser traffic |
| **ClientHello fragmentation** | `tlsFragment` | SNI keyword matching that inspects a single packet |
| **Encrypted DNS through the tunnel** | `dnsMode: secure` | DNS logging and poisoning by the local resolver |
| **FakeIP** | `dnsMode: fakeip` | Any DNS leak at all — the OS gets a synthetic `198.18.x.x` answer instantly and the real domain travels inside the tunnel |
| **DNS hijack (Full Tunnel)** | automatic with `dnsMode` | Apps that hardcode their own resolver and bypass yours |
| **Smart split routing** | `routingMode: smart` + `directRuleSets` | Keeps domestic banking/government sites on the local network (low latency, no geo-fencing trouble) while everything else is tunnelled |
| **Automatic failover** | `autoFallback` | A censor killing one transport mid-session |

**Automatic failover** is the part that matters most under active blocking.
With it on, your other saved servers become live tiers behind a sing-box
`urltest` group that continuously probes them and routes to whichever is
healthy. Tiers are ordered Hysteria2 → VLESS/Reality → Trojan/VMess →
Shadowsocks, which is roughly "fastest" → "hardest to detect" → "hardest to
block by IP": if UDP gets throttled and Hysteria2 dies, traffic moves to a
Reality/TCP tier on its own, with no reconnect.

Protocol-wise this maps onto the usual three-tier strategy: **Hysteria2 +
Salamander** for throughput on lossy links, **VLESS + XTLS-Reality** for
handshakes that survive active probing, and **VLESS over WebSocket/gRPC
behind a CDN** for when your server's own IP is blacklisted. FIST doesn't
invent servers for you — it makes whichever of these you have work together.

Geo rule-sets are fetched *through the tunnel* (`download_detour: proxy`) and
cached, so a blocked GitHub doesn't break routing and the request doesn't
reveal which country lists you use.

## Engines / extensions

Every config runs through an *engine* — whatever actually connects and
routes traffic for it. The **Engines** tab (top-right, `</>` icon) is the
registry: it always lists the built-in `sing-box` engine, plus any
extensions you've installed, with install/remove controls.

An extension is a local folder (`extension.json` manifest + an entry
script) that FIST spawns as its own child process and talks to over a
newline-delimited JSON protocol on stdin/stdout — see
[`packages/desktop/example-extensions/README.md`](packages/desktop/example-extensions/README.md)
for the exact wire protocol, and `example-extensions/demo-engine/` for a
minimal but real working reference (opens an actual local TCP forwarder).
**Installing an extension runs it with the same privileges as any other
program on your machine** — FIST isolates it into its own OS process so a
crash there doesn't take down the app, but does not sandbox what its code
does. Only install extensions you trust.

When you add a config that FIST can't parse, it offers a picker: run it as
a raw sing-box outbound, or hand it to one of your installed extensions.
Configs added this way show a small badge on their server-list card naming
the engine that runs them (and flag it in red if that extension has since
been removed).

---

## Crypto payments

The marketplace settles in crypto when the server is configured for it;
without that configuration it falls back to the original simulated-payment
route and says so on `/api/health`.

| Variable | Purpose |
|---|---|
| `CRYPTO_MNEMONIC` | HD wallet the per-invoice receiving addresses are derived from (`m/44'/60'/0'/0/<index>`) |
| `CRYPTO_RPC_URL` | JSON-RPC endpoint used to watch for incoming payments |
| `CRYPTO_ASSET` | `ETH` (default) or `MATIC` |
| `CRYPTO_COIN_PRICE_CENTS` | Price of 1 whole coin in USD cents, used to convert listing prices |
| `PLATFORM_FEE_BPS` | Platform margin in basis points (default `2000` = 20%) |

Flow: `POST /api/payments/invoice` opens an invoice for a listing and returns
a freshly-derived address plus the exact amount owed;
`GET /api/payments/invoice/:id` re-checks the chain (poll this);
`POST /api/payments/invoice/:id/claim` converts a confirmed invoice into a
purchase and releases the config. Claiming is idempotent, so a double-click
can't credit the creator twice.

**The server never spends.** It derives receiving addresses and discards the
private keys immediately, so nothing in the request path holds spending
authority. Sweeping those addresses into treasury and paying creators out is
a separate operational step that needs the mnemonic in a signer/HSM — the
ledger here records what is *owed*, it does not move funds.

---

## Repository layout

This is an npm-workspaces monorepo:

```
packages/
  core-logic/          Shared pure JS: link/subscription parsers, .fist
                        bundle codec, sing-box config builder, formatting/
                        scoring helpers. No Electron or Node-only APIs, so
                        it can be reused by a future mobile client too.
  desktop/              The Electron app itself.
    electron/           Main process: window/tray, IPC handlers, sing-box
                         process management, system proxy, kill switch,
                         elevation, the extension host, auto-updater.
    src/                Renderer: React 18 UI (no build-time CSS framework —
                         plain index.css).
    example-extensions/ Reference extension + protocol docs (see above).
    bin/<platform>/     sing-box binary — gitignored, see "Getting the
                         sing-box binary" below.
  marketplace-server/   Optional Bun + Hono + Redis backend for the config
                         marketplace (real accounts/listings/purchases,
                         mocked payment processing only).
```

---

## Getting started (development)

### Requirements

- [Node.js](https://nodejs.org/) 18+ and npm (npm workspaces drive the whole
  repo)
- [Go](https://go.dev/) 1.21+ — only needed once, to build the sing-box
  binary (see below)
- [Bun](https://bun.sh/) — only needed if you're running the marketplace
  server
- A local [Redis](https://redis.io/) instance — only needed for the
  marketplace server

### 1. Clone and install

```bash
git clone https://github.com/UniversaiLab/fist.git
cd fist
npm install
```

### 2. Get the sing-box binary

sing-box is FIST's actual connection engine, and its binary is **not**
committed to the repo (`bin/` is gitignored — it's large, per-platform, and
easy to rebuild). Build it yourself with the same version and build tags CI
uses, so every feature (Hysteria2, WireGuard, the stats API, etc.) actually
works:

```bash
go install -tags "with_quic,with_grpc,with_utls,with_clash_api,with_v2ray_api,with_wireguard,with_gvisor" \
  github.com/sagernet/sing-box/cmd/sing-box@v1.13.14
```

Then copy the built binary into `packages/desktop/bin/<platform>/`, matching
`process.platform` values:

```bash
# Linux
mkdir -p packages/desktop/bin/linux
cp "$(go env GOPATH)/bin/sing-box" packages/desktop/bin/linux/sing-box

# macOS
mkdir -p packages/desktop/bin/darwin
cp "$(go env GOPATH)/bin/sing-box" packages/desktop/bin/darwin/sing-box

# Windows (PowerShell)
mkdir packages\desktop\bin\win32
copy "$(go env GOPATH)\bin\sing-box.exe" packages\desktop\bin\win32\sing-box.exe
```

Without this, the app still launches, but every "Connect" attempt fails
with "The connection core (sing-box) file was not found."

### 3. Run in dev mode

```bash
npm run dev
```

This builds the renderer once (`vite build` — there's no HMR dev server;
Electron loads the built `dist/index.html` directly) and launches Electron.
Re-run `npm run dev` after changing renderer (`src/`) code. Main-process
(`electron/`) changes need a full restart.

You can also preview just the renderer UI in a plain browser (with mocked
IPC — no real connections) via Vite directly from `packages/desktop`:

```bash
cd packages/desktop
npx vite
```

---

## Building for production

All commands run from the repo root (they delegate to the `packages/desktop`
workspace):

```bash
npm run dist            # current OS, NSIS installer on Windows
npm run dist:portable   # Windows portable .exe, no installer
npm run dist:mac        # macOS .dmg + .zip
npm run dist:linux      # Linux AppImage + .deb
npm run dist:publish    # build and publish to GitHub Releases
```

Each target needs the matching platform's `bin/<platform>/sing-box[.exe]`
present (see step 2 above) — `electron-builder` bundles it as an
`extraResource`. `.github/workflows/build.yml` runs the same build on a
Windows/macOS/Linux matrix on every push, building sing-box from source on
each runner first.

---

## The marketplace server (optional)

`packages/marketplace-server` is the backend (accounts, listings, purchases,
ratings, per-creator earnings, crypto invoices) for the desktop app's
Marketplace tab. Crypto settlement is real when configured (see
[Crypto payments](#crypto-payments)); with no crypto config the legacy
`/api/purchases` route simulates payment instead. The desktop Marketplace tab
still browses client-side mock listings — the Wallet pane is the part wired
to this server today.

Requires Bun and a reachable Redis:

```bash
cd packages/marketplace-server
bun install
REDIS_URL=redis://localhost:6379 bun run dev   # or: npm run marketplace:server:dev (from repo root)
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` (Bun's default) | Redis connection |
| `JWT_SECRET` | an insecure dev default | HS256 signing key for auth tokens. With `NODE_ENV=production` the server refuses to start unless this is set to a unique value of at least 32 characters |
| `PORT` | `4310` | HTTP port |

---

## Where FIST stores your data

Per-user, not in the repo:

- **Windows**: `%APPDATA%\FIST\`
- **macOS**: `~/Library/Application Support/FIST/`
- **Linux**: `~/.config/FIST/`

Inside: `profiles.json` (configs, subscriptions, settings — plain JSON, no
external database), `extensions/` (installed engine extensions),
`singbox-run/` (the active generated sing-box config + its logs, also
reachable from Settings → Advanced → "Open").

---

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

FIST is a general-purpose proxy/VPN client. You're responsible for
complying with the laws and terms of service that apply to you and to
whatever servers/configs you connect it to.
