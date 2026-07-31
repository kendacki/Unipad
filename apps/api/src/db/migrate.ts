import { pool } from "./pool.js";

const SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS creators (
  principal TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  creator_principal TEXT NOT NULL REFERENCES creators(principal),
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_supply INT NOT NULL CHECK (total_supply > 0),
  minted_count INT NOT NULL DEFAULT 0 CHECK (minted_count >= 0),
  royalty_bps INT NOT NULL DEFAULT 500 CHECK (royalty_bps >= 0 AND royalty_bps <= 10000),
  launch_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collections_creator_idx ON collections(creator_principal);
CREATE INDEX IF NOT EXISTS collections_status_idx ON collections(status);

CREATE TABLE IF NOT EXISTS collection_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  price_uct TEXT NOT NULL,
  max_per_wallet INT NOT NULL DEFAULT 1,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  supply_cap INT,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS phases_collection_idx ON collection_phases(collection_id);

CREATE TABLE IF NOT EXISTS mint_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id),
  token_id INT NOT NULL,
  owner_principal TEXT NOT NULL,
  mint_tx_ref TEXT NOT NULL,
  payment_ref TEXT NOT NULL,
  phase_id UUID REFERENCES collection_phases(id),
  price_uct TEXT NOT NULL,
  minted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, token_id),
  UNIQUE (payment_ref)
);

CREATE INDEX IF NOT EXISTS mint_ledger_owner_idx ON mint_ledger(owner_principal);

CREATE TABLE IF NOT EXISTS mint_intents (
  idempotency_key TEXT PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES collections(id),
  phase_id UUID NOT NULL REFERENCES collection_phases(id),
  wallet_principal TEXT NOT NULL,
  price_uct TEXT NOT NULL,
  payment_memo TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  payment_ref TEXT UNIQUE,
  token_id INT,
  mint_tx_ref TEXT,
  reason TEXT,
  queue_position INT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mint_intents_wallet_idx ON mint_intents(wallet_principal, collection_id);
CREATE INDEX IF NOT EXISTS mint_intents_status_idx ON mint_intents(status);

CREATE TABLE IF NOT EXISTS allowlist_entries (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  wallet_principal TEXT NOT NULL,
  phase_id UUID NOT NULL REFERENCES collection_phases(id) ON DELETE CASCADE,
  max_mints INT NOT NULL DEFAULT 1,
  PRIMARY KEY (collection_id, wallet_principal, phase_id)
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  chain_pubkey TEXT NOT NULL,
  domain TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS royalty_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL UNIQUE REFERENCES mint_ledger(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES collections(id),
  creator_principal TEXT NOT NULL,
  gross_uct TEXT NOT NULL,
  platform_fee_uct TEXT NOT NULL,
  creator_net_uct TEXT NOT NULL,
  payout_status TEXT NOT NULL DEFAULT 'accrued',
  payout_batch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS royalty_ledger_creator_idx ON royalty_ledger(creator_principal, payout_status);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
  uploader_principal TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  local_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  ipfs_cid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_collection_idx ON media_assets(collection_id);

CREATE TABLE IF NOT EXISTS payment_receipts (
  payment_ref TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL REFERENCES mint_intents(idempotency_key),
  wallet_principal TEXT NOT NULL,
  amount_uct TEXT NOT NULL,
  memo TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function main() {
  await pool.query(SQL);
  console.log("Migrations applied.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
