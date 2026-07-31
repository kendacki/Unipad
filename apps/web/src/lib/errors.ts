/** User-facing error catalog — short copy + stable codes */

export type ErrorInfo = {
  code: string;
  title: string;
  message: string;
};

const CATALOG: Record<string, ErrorInfo> = {
  UPAD_NETWORK: {
    code: "UPAD_NETWORK",
    title: "Connection issue",
    message: "We couldn’t reach Unipad. Check your internet and try again.",
  },
  UPAD_UNAUTHORIZED: {
    code: "UPAD_UNAUTHORIZED",
    title: "Sign in needed",
    message: "Connect your wallet to continue.",
  },
  UPAD_FORBIDDEN: {
    code: "UPAD_FORBIDDEN",
    title: "Not allowed",
    message: "Your wallet can’t do this right now.",
  },
  UPAD_SOLD_OUT: {
    code: "UPAD_SOLD_OUT",
    title: "Sold out",
    message: "This drop has no more items left to mint.",
  },
  UPAD_NOT_ALLOWLISTED: {
    code: "UPAD_NOT_ALLOWLISTED",
    title: "Not on the list",
    message: "This phase is for allowlisted wallets only.",
  },
  UPAD_MINT_CAP: {
    code: "UPAD_MINT_CAP",
    title: "Limit reached",
    message: "You’ve already minted the max for this phase.",
  },
  UPAD_CREATOR_ONLY: {
    code: "UPAD_CREATOR_ONLY",
    title: "Creator only",
    message: "Only the collection creator can mint in this phase.",
  },
  UPAD_NO_PHASE: {
    code: "UPAD_NO_PHASE",
    title: "Minting closed",
    message: "There’s no open mint phase right now. Check back later.",
  },
  UPAD_NOT_MINTABLE: {
    code: "UPAD_NOT_MINTABLE",
    title: "Not live yet",
    message: "This collection isn’t open for minting.",
  },
  UPAD_PAYMENT_REQUIRED: {
    code: "UPAD_PAYMENT_REQUIRED",
    title: "Payment needed",
    message: "Pay with UCT, then we’ll finish your mint.",
  },
  UPAD_PAYMENT_USED: {
    code: "UPAD_PAYMENT_USED",
    title: "Payment already used",
    message: "That payment was already applied to another mint.",
  },
  UPAD_PAYMENT_MISMATCH: {
    code: "UPAD_PAYMENT_MISMATCH",
    title: "Payment doesn’t match",
    message: "The payment memo didn’t match this mint. Try again.",
  },
  UPAD_RATE_LIMIT: {
    code: "UPAD_RATE_LIMIT",
    title: "Slow down",
    message: "Too many requests. Wait a moment and try again.",
  },
  UPAD_VALIDATION: {
    code: "UPAD_VALIDATION",
    title: "Check your details",
    message: "Something in the form looks incomplete or invalid.",
  },
  UPAD_NOT_FOUND: {
    code: "UPAD_NOT_FOUND",
    title: "Not found",
    message: "We couldn’t find that collection or request.",
  },
  UPAD_IDEMPOTENCY: {
    code: "UPAD_IDEMPOTENCY",
    title: "Missing request id",
    message: "Refresh and try minting again.",
  },
  UPAD_UNKNOWN: {
    code: "UPAD_UNKNOWN",
    title: "Something went wrong",
    message: "Please try again. If it keeps happening, reconnect your wallet.",
  },
};

const MESSAGE_TO_CODE: Array<[RegExp | string, string]> = [
  ["Sold out", "UPAD_SOLD_OUT"],
  ["sold_out", "UPAD_SOLD_OUT"],
  ["Wallet not on allowlist", "UPAD_NOT_ALLOWLISTED"],
  ["Allowlist mint cap", "UPAD_MINT_CAP"],
  ["Wallet mint cap", "UPAD_MINT_CAP"],
  ["Creator phase", "UPAD_CREATOR_ONLY"],
  ["No active mint phase", "UPAD_NO_PHASE"],
  ["not mintable", "UPAD_NOT_MINTABLE"],
  ["paymentRef required", "UPAD_PAYMENT_REQUIRED"],
  ["paymentRef already", "UPAD_PAYMENT_USED"],
  ["Payment memo mismatch", "UPAD_PAYMENT_MISMATCH"],
  ["Mock payments disabled", "UPAD_PAYMENT_MISMATCH"],
  ["Rate limit", "UPAD_RATE_LIMIT"],
  ["Idempotency-Key", "UPAD_IDEMPOTENCY"],
  ["Not found", "UPAD_NOT_FOUND"],
  ["Unknown mint intent", "UPAD_NOT_FOUND"],
  ["Missing bearer", "UPAD_UNAUTHORIZED"],
  ["Invalid or expired", "UPAD_UNAUTHORIZED"],
  ["Forbidden", "UPAD_FORBIDDEN"],
  ["Connect your wallet", "UPAD_UNAUTHORIZED"],
];

export class ApiError extends Error {
  code: string;
  status: number;
  title: string;

  constructor(message: string, opts?: { code?: string; status?: number }) {
    const info = resolveError(message, opts?.code, opts?.status);
    super(info.message);
    this.name = "ApiError";
    this.code = info.code;
    this.status = opts?.status ?? 400;
    this.title = info.title;
  }
}

export function resolveError(
  rawMessage?: string,
  code?: string,
  status?: number,
): ErrorInfo {
  if (code && CATALOG[code]) {
    return { ...CATALOG[code], message: rawMessage || CATALOG[code].message };
  }

  if (status === 401) return CATALOG.UPAD_UNAUTHORIZED;
  if (status === 429) return CATALOG.UPAD_RATE_LIMIT;
  if (status === 404) return CATALOG.UPAD_NOT_FOUND;
  if (status === 403) {
    const fromMsg = matchMessage(rawMessage);
    if (fromMsg) return fromMsg;
    return CATALOG.UPAD_FORBIDDEN;
  }

  const matched = matchMessage(rawMessage);
  if (matched) return matched;

  if (!rawMessage) return CATALOG.UPAD_UNKNOWN;
  return {
    code: "UPAD_UNKNOWN",
    title: CATALOG.UPAD_UNKNOWN.title,
    message: rawMessage,
  };
}

function matchMessage(raw?: string): ErrorInfo | null {
  if (!raw) return null;
  for (const [pattern, code] of MESSAGE_TO_CODE) {
    const hit =
      typeof pattern === "string"
        ? raw.toLowerCase().includes(pattern.toLowerCase())
        : pattern.test(raw);
    if (hit && CATALOG[code]) {
      return CATALOG[code];
    }
  }
  return null;
}

export function toUserError(err: unknown): ErrorInfo {
  if (err instanceof ApiError) {
    return { code: err.code, title: err.title, message: err.message };
  }
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return CATALOG.UPAD_NETWORK;
  }
  if (err instanceof Error) {
    return resolveError(err.message);
  }
  return CATALOG.UPAD_UNKNOWN;
}
