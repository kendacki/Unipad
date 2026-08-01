export type CollectionStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "sold_out"
  | "ended";

export type PhaseType = "creator" | "allowlist" | "public";

export type MintStatus =
  | "intent_created"
  | "awaiting_payment"
  | "payment_received"
  | "queued"
  | "minting"
  | "confirmed"
  | "rejected"
  | "refund_pending";

export interface CollectionPhase {
  id: string;
  type: PhaseType;
  name: string;
  priceUct: string; // base units as decimal string
  maxPerWallet: number;
  startsAt: string | null;
  endsAt: string | null;
  supplyCap: number | null;
}

export interface Collection {
  id: string;
  slug: string;
  name: string;
  description: string;
  creatorPrincipal: string;
  creatorDisplayName: string;
  coverUrl: string | null;
  status: CollectionStatus;
  totalSupply: number;
  mintedCount: number;
  remainingSupply: number;
  royaltyBps: number;
  phases: CollectionPhase[];
  activePhase: CollectionPhase | null;
  createdAt: string;
  launchAt: string | null;
}

export interface MintIntentResponse {
  idempotencyKey: string;
  collectionId: string;
  phaseId: string;
  priceUct: string;
  payment: {
    /** Display symbol */
    coinId: "UCT";
    /** Canonical 64-hex coin id for Sphere Connect `send` intents */
    coinIdHex: string;
    amount: string;
    recipient: string;
    memo: string;
  };
  expiresAt: string;
  nonce: string;
}

export interface MintResult {
  status: MintStatus;
  idempotencyKey: string;
  tokenId?: number;
  mintTxRef?: string;
  queuePosition?: number;
  reason?: string;
}

export interface AuthChallenge {
  nonce: string;
  challenge: string;
  expiresAt: number;
}

export interface AuthSession {
  token: string;
  chainPubkey: string;
  expiresIn: number;
  displayName?: string;
}

export interface CreateCollectionInput {
  name: string;
  slug: string;
  description: string;
  totalSupply: number;
  royaltyBps: number;
  coverUrl?: string;
  /** Optional public creator / studio name shown on the drop. */
  creatorDisplayName?: string;
  launchAt?: string | null;
  phases: Array<{
    type: PhaseType;
    name: string;
    priceUct: string;
    maxPerWallet: number;
    startsAt?: string | null;
    endsAt?: string | null;
    supplyCap?: number | null;
  }>;
}

export interface RoyaltySummary {
  accruedUct: string;
  paidUct: string;
  platformFeeBps: number;
  /** Sum of mint sale prices (before fee). */
  grossSalesUct: string;
  /** Sum of platform fees taken from primary mints. */
  platformFeesUct: string;
  saleCount: number;
}

export interface RoyaltyEntry {
  id: string;
  saleId: string;
  collectionId: string;
  collectionName: string;
  grossUct: string;
  platformFeeUct: string;
  creatorNetUct: string;
  payoutStatus: string;
  createdAt: string;
  /** When the seller sent this credit out (Sphere payout). */
  paidAt?: string | null;
  /** @nametag or principal the seller paid. */
  payoutRecipient?: string | null;
  /** Seller Sphere @nametag shown on the payout (not the drop name). */
  payoutSender?: string | null;
}

/** Default primary-mint platform fee: 2.5% (250 bps). */
export const DEFAULT_PLATFORM_FEE_BPS = 250;

export function normalizePlatformFeeBps(raw?: number | string | null): number {
  const n = Number(raw ?? DEFAULT_PLATFORM_FEE_BPS);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return DEFAULT_PLATFORM_FEE_BPS;
  return Math.floor(n);
}

/** Split a mint sale: platform fee first, remainder credited to the seller. */
export function splitMintProceeds(
  grossUct: string,
  feeBps: number = DEFAULT_PLATFORM_FEE_BPS,
): {
  grossUct: string;
  platformFeeUct: string;
  creatorNetUct: string;
  feeBps: number;
} {
  const gross = BigInt(grossUct || "0");
  if (gross < 0n) throw new Error("Invalid gross");
  const bps = normalizePlatformFeeBps(feeBps);
  const platformFeeUct = (gross * BigInt(bps)) / 10000n;
  const creatorNetUct = gross - platformFeeUct;
  return {
    grossUct: gross.toString(),
    platformFeeUct: platformFeeUct.toString(),
    creatorNetUct: creatorNetUct.toString(),
    feeBps: bps,
  };
}

/** Aggregate royalty ledger rows into the dashboard summary (single source of truth). */
export function summarizeRoyaltyLedger(
  entries: Array<{
    grossUct: string;
    platformFeeUct: string;
    creatorNetUct: string;
    payoutStatus: string;
    saleId?: string;
  }>,
  feeBps: number = DEFAULT_PLATFORM_FEE_BPS,
): RoyaltySummary {
  let accrued = 0n;
  let paid = 0n;
  let gross = 0n;
  let fees = 0n;
  const saleRoots = new Set<string>();
  for (const e of entries) {
    const net = BigInt(e.creatorNetUct || "0");
    gross += BigInt(e.grossUct || "0");
    fees += BigInt(e.platformFeeUct || "0");
    if (e.payoutStatus === "paid") paid += net;
    else accrued += net;
    if (e.saleId) {
      // Partial payouts append `:payout:` — count as one sale for the dashboard.
      saleRoots.add(e.saleId.split(":payout:")[0] || e.saleId);
    }
  }
  return {
    accruedUct: accrued.toString(),
    paidUct: paid.toString(),
    platformFeeBps: normalizePlatformFeeBps(feeBps),
    grossSalesUct: gross.toString(),
    platformFeesUct: fees.toString(),
    saleCount: saleRoots.size > 0 ? saleRoots.size : entries.length,
  };
}

export interface AllowlistEntry {
  walletPrincipal: string;
  phaseId: string;
  maxMints: number;
}

export interface MediaUploadResult {
  id: string;
  url: string;
  contentHash: string;
  deduped: boolean;
}

export const UCT_DECIMALS = 18;

/**
 * Canonical UCT coin id on Unicity testnet2
 * (https://github.com/unicitynetwork/unicity-ids — unicity-ids.testnet2.json).
 */
export const UCT_COIN_ID =
  "f581d30f593e4b369d684a4563b5246f07b1d265f7178a2c0a82b81f39c24dc0";

/**
 * Normalize a Unicity payment recipient for Sphere `send` / Connect intents.
 *
 * Official Sphere format is `@nametag` (see CONNECT.md: `to: '@alice'`).
 * Also accepts bare nametags, `name@unicity` display forms, DIRECT://, and hex pubkeys.
 */
export function normalizeSphereRecipient(raw: string): string {
  const value = raw.trim();
  if (!value) return value;

  if (value.startsWith("DIRECT://") || /^(PROXY|DIRECT):/i.test(value)) {
    return value;
  }
  if (/^[0-9a-f]{64,66}$/i.test(value)) {
    return value.toLowerCase();
  }

  // Display forms like cryptzarr@unicity or cryptzarr@unicity.network → cryptzarr
  const atUnicity = value.match(/^@?([a-z0-9_-]{3,32})@unicity(?:\.[a-z0-9.-]+)?$/i);
  if (atUnicity) {
    return `@${atUnicity[1].toLowerCase()}`;
  }

  const nametag = value.replace(/^@+/, "").trim().toLowerCase();
  if (/^[a-z0-9_+-]{3,32}$/.test(nametag) || /^\+[0-9]{7,15}$/.test(nametag)) {
    return `@${nametag}`;
  }

  return value.startsWith("@") ? value : `@${value}`;
}

/** Default Unipad treasury Unicity ID (Sphere nametag). */
export const DEFAULT_TREASURY_PRINCIPAL = "@cryptzarr";

export function formatUct(baseUnits: string | number, decimals = UCT_DECIMALS): string {
  const raw = typeof baseUnits === "number" ? BigInt(baseUnits) : BigInt(baseUnits || "0");
  const zero = BigInt(0);
  const ten = BigInt(10);
  const neg = raw < zero;
  const v = neg ? -raw : raw;
  const base = ten ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : whole.toString();
  return neg ? `-${body}` : body;
}

export function parseUct(display: string, decimals = UCT_DECIMALS): string {
  const cleaned = display.trim();
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error("Invalid UCT amount");
  }
  const [w, f = ""] = cleaned.split(".");
  if (f.length > decimals) throw new Error("Too many decimal places");
  const frac = f.padEnd(decimals, "0");
  const ten = BigInt(10);
  return (BigInt(w) * ten ** BigInt(decimals) + BigInt(frac || "0")).toString();
}
