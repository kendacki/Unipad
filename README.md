# Unipad

**NFT launchpad for the Unicity community** — list for free, mint with UCT, keep what you earn.

**Live:** [https://unipadnfts.vercel.app](https://unipadnfts.vercel.app)

Unipad is built for creators and collectors on Unicity. There is **no listing fee**. Publish a drop, share it with the community, and collect UCT when people mint.

---

## Why Unipad

| For the community | What that means |
|-------------------|-----------------|
| **No listing fee** | Creating and publishing a drop is free |
| **Pay once to mint** | Buyers pay UCT first — then Unipad confirms the NFT |
| **Seller earnings** | Mint proceeds (after a small platform fee) credit your Earnings balance |
| **Sphere wallet** | Connect, mint, and transfer with the official Unicity wallet |
| **Live + Upcoming** | Publish now, or schedule a drop for later |

---

## What you can do

### Creators
- Create a drop (name, owner, cover, supply, UCT price)
- Optional early-access (allowlist) guest list
- Publish **live** or **schedule** for later
- Preview a draft before you publish
- Track **Balance**, **Earned**, and **Paid out** on Earnings

### Collectors
- Browse **Live** and **Upcoming** drops
- Connect Sphere and mint with UCT
- View NFTs in **My mints**
- Send an NFT to a `@nametag` or chain pubkey

---

## How minting works

1. Open a live drop and tap mint  
2. Unipad creates a mint intent (price, treasury, memo)  
3. You approve the UCT payment in **Sphere**  
4. Unipad settles the mint and credits the seller’s earnings  
5. The NFT shows under **My mints**

No gas wars — payment first, mint after.

---

## Tech stack

| Layer | Stack |
|-------|--------|
| Storefront | [Next.js 15](https://nextjs.org/), React 19, TypeScript |
| Motion / UI | Framer Motion |
| Wallet | [Sphere SDK](https://github.com/unicity-sphere/sphere-sdk) (`@unicitylabs/sphere-sdk`) |
| Auth | JWT sessions (`jose`) after Sphere connect |
| Production data | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) (listings, mints, earnings, covers) |
| Shared types | `packages/shared` (UCT parse/format, fee split helpers) |
| Optional API | Hono + Postgres + Redis (`apps/api`) for full hosted backend |
| Monorepo | pnpm workspaces |

**Production note:** The live site ([unipadnfts.vercel.app](https://unipadnfts.vercel.app)) serves the Next.js app with same-origin `/v1/*` routes and Blob persistence. The Hono API + Postgres stack remains available for local/full backend deployments.

---

## Repository layout

| Path | Role |
|------|------|
| `apps/web` | Next.js storefront, create flow, mint, earnings, My mints |
| `apps/api` | Optional Hono API (auth, mint queue, Postgres royalties) |
| `packages/shared` | Shared types, UCT helpers, platform fee split |
| `deploy/` | Optional nginx / edge compose profiles |

---

## Sphere & network

- Wallet: [https://sphere.unicity.network](https://sphere.unicity.network)  
- Network: **testnet2**  
- Token: **UCT** (18 decimals)  
- Docs: [CONNECT.md](https://github.com/unicity-sphere/sphere-sdk/blob/main/docs/CONNECT.md)

---

## Run locally

### Requirements

- Node.js **22+**
- [pnpm](https://pnpm.io/)
- Docker (Postgres + Redis, if you use the API)

### Quick start (web + API)

```bash
pnpm db:up
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| Service | URL |
|---------|-----|
| Website | http://localhost:3000 |
| API health | http://localhost:8787/health |

Copy `.env.example` → `.env`. Never commit secrets.

---

## Production (Vercel)

Site: [https://unipadnfts.vercel.app](https://unipadnfts.vercel.app)

- **Root Directory:** `apps/web`  
- Pushes to `main` redeploy automatically  

### Important env vars (web / Vercel)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (preferred store) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key for ledger + media |
| `SUPABASE_OBJECTS_TABLE` | Optional; default `unipad_objects` |
| `SUPABASE_MEDIA_BUCKET` | Optional; default `unipad-media` (public) |
| `BLOB_READ_WRITE_TOKEN` | Legacy fallback only if Supabase is unset |
| `JWT_SECRET` | Session tokens |
| `TREASURY_PRINCIPAL` | UCT mint recipient (e.g. `@cryptzarr`) |
| `PLATFORM_FEE_BPS` | Mint platform fee in bps (default `250` = 2.5%) |
| `NEXT_PUBLIC_UCT_COIN_ID` | Canonical UCT coin id (testnet2) |
| `NEXT_PUBLIC_SPHERE_WALLET_URL` | `https://sphere.unicity.network` |
| `NEXT_PUBLIC_NETWORK` | `testnet2` |
| `NEXT_PUBLIC_SITE_URL` | `https://unipadnfts.vercel.app` |
| `NEXT_PUBLIC_UNIPAD_DEV_MOCK` | Must be `false` in production |

**Supabase setup:** run `apps/web/supabase/unipad_objects.sql` in the SQL editor, create/public the `unipad-media` bucket, then set the env vars on Vercel. Pathnames stay the same (`listings/…`, `mints/…`, `earnings/…`). To copy existing Blob JSON into Supabase once: `pnpm --filter @unipad/web exec tsx scripts/migrate-blob-to-supabase.mts` (with both tokens set).

See `.env.example` for the full list (including optional API / Redis settings).

---

## Features

| Feature | Status |
|---------|--------|
| Free listing (no create fee) | Done |
| Browse Live / Upcoming / All | Done |
| Create, draft preview, publish / schedule | Done |
| Cover upload (Supabase Storage) or image link | Done |
| Sphere connect + UCT mint | Done |
| Seller Earnings dashboard | Done |
| My mints + NFT transfer | Done |
| Allowlist (early access) | Done |
| Optional API rate limits + nginx LB | Done |

### Still evolving

- Stronger on-chain uniqueness / payment proofs  
- Secondary market (royalties UI deferred until then)  
- Large-scale infra (K8s, Kafka, dual IPFS)

---

## Commands

| Command | What it does |
|---------|----------------|
| `pnpm dev` | Web + API together |
| `pnpm db:up` | Postgres + Redis |
| `pnpm db:migrate` / `pnpm db:seed` | Schema + sample data |
| `pnpm edge:up` / `pnpm edge:scale` | Optional API + nginx LB |
| `pnpm --filter @unipad/web build` | Production web build |

---

## Community & links

- **Live app:** [unipadnfts.vercel.app](https://unipadnfts.vercel.app)  
- **Repo:** [github.com/kendacki/Unipad](https://github.com/kendacki/Unipad)  
- **Sphere:** [sphere.unicity.network](https://sphere.unicity.network)  

Built for Unicity creators and collectors — list free, mint fair, earn on-chain with UCT.
