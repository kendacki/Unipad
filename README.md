<div style="font-family: 'Times New Roman', Times, serif;">

# Unipad

Unipad is an NFT launchpad built for the **Unicity** network. Creators can publish drops. Buyers can mint NFTs and pay with **UCT** (Unicity Token).

---

## 1. What Unipad Does

Unipad has two main jobs:

1. **Create a drop** — set a name, cover, supply, and price in UCT, then publish.
2. **Mint an NFT** — connect a Sphere wallet, pay UCT, and receive the NFT.

There are no gas wars. Payment happens first in UCT. Unipad then finishes the mint.

---

## 2. Who This Is For

| Role | What they do |
|------|----------------|
| Creators | Launch drops, set prices, view earnings |
| Collectors | Browse live drops and mint with UCT |
| Developers | Run the app locally or deploy the web app on Vercel |

---

## 3. Project Structure

This repository is a monorepo (one project with several packages):

| Folder | Purpose |
|--------|---------|
| `apps/web` | Website (Next.js) — storefront, mint page, create flow |
| `apps/api` | Backend API — auth, minting, queue, royalties |
| `packages/shared` | Shared types and UCT amount helpers |

---

## 4. How Minting Works

Unipad uses a **pay-then-mint** flow:

1. The buyer opens a drop and starts a mint.
2. Unipad creates a mint intent (price, treasury address, memo).
3. The buyer pays UCT through the **Sphere** wallet.
4. Unipad confirms the payment and mints the NFT.
5. The NFT appears under **My mints**.

---

## 5. Wallet Connection (Sphere)

Unipad connects to the official Sphere wallet:

- Wallet site: [https://sphere.unicity.network](https://sphere.unicity.network)
- Network: **testnet2**
- Payment token: **UCT** (18 decimals)

When you click **Connect Sphere**, Unipad opens the Sphere wallet (browser extension or popup). You approve the connection, then you can mint or create drops.

Official references:

- [Sphere SDK](https://github.com/unicity-sphere/sphere-sdk)
- [Connect guide](https://github.com/unicity-sphere/sphere-sdk/blob/main/docs/CONNECT.md)
- [Connect example](https://github.com/unicity-sphere/sphere-sdk-connect-example)

---

## 6. Run Locally

### Requirements

- Node.js 22 or newer
- [pnpm](https://pnpm.io/)
- Docker (for Postgres and Redis)

### Steps

```bash
pnpm db:up
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

### Local URLs

| Service | Address |
|---------|---------|
| Website | http://localhost:3000 |
| API health | http://localhost:8787/health |

Copy `.env.example` to `.env` and keep secrets out of git. Never commit a real `.env` file.

---

## 7. Deploy the Website on Vercel

1. Import this repository into Vercel.
2. Set the **Root Directory** to `apps/web`.
3. Add the environment variables below.
4. Deploy.
5. Open the site and click **Connect Sphere**. Allow the popup if the browser asks.

### Website environment variables

| Variable | Meaning | Example |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | Your API base URL | `https://your-api.example.com` |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL for live updates | `wss://your-api.example.com` |
| `NEXT_PUBLIC_SPHERE_WALLET_URL` | Sphere wallet URL | `https://sphere.unicity.network` |
| `NEXT_PUBLIC_UCT_COIN_ID` | Official UCT coin id | See `.env.example` |
| `NEXT_PUBLIC_NETWORK` | Unicity network name | `testnet2` |
| `NEXT_PUBLIC_UNIPAD_DEV_MOCK` | Demo wallet (must be off in production) | `false` |

### API environment variables

| Variable | Meaning |
|----------|---------|
| `FRONTEND_ORIGIN` | Your Vercel site URL (for CORS) |
| `AUTH_DOMAIN` | Your site hostname (no `https://`) |
| `TREASURY_PRINCIPAL` | Sphere account that receives mint payments |
| `JWT_SECRET` | Strong secret for login sessions |
| `UNIPAD_DEV_MOCK` | Set to `false` in production |

---

## 8. Main Features

| Feature | Status |
|---------|--------|
| Browse and filter drops | Done |
| Create and publish a drop | Done |
| Sphere wallet connect | Done |
| Pay with UCT, then mint | Done |
| Mint queue and live updates | Done |
| My mints | Done |
| Creator earnings (royalties) | Done |
| Local image upload | Done |

### Not included yet

- Full on-chain uniqueness oracle
- Full payment proof verification beyond Sphere Connect transfer ids
- Large-scale infrastructure (Kubernetes, Kafka, dual IPFS pin)

---

## 9. Useful Commands

| Command | What it does |
|---------|----------------|
| `pnpm dev` | Start website and API together |
| `pnpm db:up` | Start Postgres and Redis |
| `pnpm db:migrate` | Create database tables |
| `pnpm db:seed` | Add sample drop data |
| `pnpm --filter @unipad/web build` | Build the website for production |

---

## 10. License and Contact

This project is the Unipad MVP codebase for Unicity.

Repository: [https://github.com/kendacki/Unipad](https://github.com/kendacki/Unipad)

</div>
