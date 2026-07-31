# Unipad

NFT launchpad built for **Unicity**, with **Unicity Token (UCT)** as the mint payment currency.

Aligned to the Architecture Audit MVP (Phase 0–1 + early creator tooling) and official Unicity Sphere repos:

| Upstream | What we follow |
|----------|----------------|
| [sphere-sdk](https://github.com/unicity-sphere/sphere-sdk) + [CONNECT.md](https://github.com/unicity-sphere/sphere-sdk/blob/main/docs/CONNECT.md) | Sphere Connect `autoConnect`, `SPHERE_NETWORKS.testnet2`, `sign_message` + `send` intents |
| [sphere-sdk-connect-example](https://github.com/unicity-sphere/sphere-sdk-connect-example) | dApp metadata, permission scopes, send result (`transferId` / `deliveryPending`) |
| [unicity-ids](https://github.com/unicitynetwork/unicity-ids) | UCT **18 decimals**, coin id `455ad872…41d89` |

## Sphere Connect compliance

- **Network gate:** handshake sends `network: SPHERE_NETWORKS.testnet2` (`id: 4`) — required or wallet rejects with `INCOMPATIBLE_NETWORK`
- **dApp metadata:** `{ name: "Unipad", url: location.origin }` on every connect (Vercel origin is sent automatically)
- **Auth:** `intent('sign_message')` → backend verifies with `@unicitylabs/sphere-sdk` helpers
- **Pay:** `intent('send', { to, amount, coinId, memo })` with amount in **base units** and **64-hex** `coinId` (never the symbol alone)
- **Delivery-pending:** treated as paid (`sphere-pending:<memo>`) — never auto-retry send
- **Connect button:** statically calls `autoConnect` so the Sphere **popup/extension** opens inside the click gesture (required on Vercel / Chrome)
- **Production:** mock wallet is **disabled** when `NODE_ENV=production` — Connect always opens real Sphere

## Deploy on Vercel

1. Import the repo → set **Root Directory** to `apps/web`
2. Framework: Next.js (uses `apps/web/vercel.json`)
3. Set environment variables (Production):

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `https://your-api.example.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://your-api.example.com` |
| `NEXT_PUBLIC_SPHERE_WALLET_URL` | `https://sphere.unicity.network` |
| `NEXT_PUBLIC_UCT_COIN_ID` | `455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89` |
| `NEXT_PUBLIC_NETWORK` | `testnet2` |
| `NEXT_PUBLIC_UNIPAD_DEV_MOCK` | `false` |

4. On the **API** host, set matching:

| Variable | Example |
|----------|---------|
| `FRONTEND_ORIGIN` | `https://your-app.vercel.app` |
| `AUTH_DOMAIN` | `your-app.vercel.app` |
| `UNIPAD_DEV_MOCK` | `false` |
| `TREASURY_PRINCIPAL` | your Sphere nametag / principal that receives UCT |
| `JWT_SECRET` | strong random secret |

5. After deploy: tap **Connect Sphere** → allow the popup → approve Unipad in [Sphere](https://sphere.unicity.network) (testnet2).

## Quick start

```bash
pnpm db:up
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000  
- API: http://localhost:8787/health  

After changing `UCT_DECIMALS` (now **18**), re-run `pnpm db:seed` so prices match Unicity base units.

## Audit API surface (implemented)

| Endpoint | Status |
|----------|--------|
| `GET/POST` auth challenge/verify (+ mock) | Done |
| `GET /v1/collections`, `GET /v1/collections/:id` | Done |
| `POST .../mint-intent`, `POST .../mint`, `GET .../mint-status` | Done |
| `POST /v1/creators/collections`, publish | Done |
| `PATCH /v1/creators/collections/:id/phases` | Done |
| Allowlist GET/POST | Done |
| `GET /v1/creators/me/royalties` | Done |
| `POST /v1/media/upload` + `/uploads/*` | Done |
| WebSocket `supply.updated`, `mint.confirmed`, `mint.result`, `queue.position` | Done |

## Still deferred (later audit phases)

- Live Uniqueness Oracle / Astrid `capsule-mint` (DB UNIQUE is the stand-in)
- Real Sphere payment proof verification at the gateway (mock/dev trusts memo-bound refs; live trusts Connect `transferId`)
- Kong/Envoy, multi-region K8s, Kafka, IPFS dual-pin, chaos/DR game-days

## Pay-then-mint

1. Mint intent → UCT amount (base units) + treasury + memo + `coinIdHex`  
2. Client pays via Sphere Connect `send` (or mock)  
3. Mint with `Idempotency-Key` + `paymentRef` → queue → ledger + royalty accrual  

## Monorepo

| Path | Role |
|------|------|
| `apps/web` | Next.js storefront + launch + royalties |
| `apps/api` | Hono API, queue, rate limit, media |
| `packages/shared` | Types + UCT helpers (18 decimals) |
