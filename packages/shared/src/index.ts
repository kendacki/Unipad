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

/** Canonical UCT coin id (Unicity testnet registry / unicity-ids). */
export const UCT_COIN_ID =
  "455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89";

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
