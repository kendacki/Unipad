import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import {
  recoverPubkeyFromSignature,
  verifySignedMessage,
} from "@unicitylabs/sphere-sdk/core";
import { buildChallenge, reconstructChallenge } from "./challenge";

const CHAIN_PUBKEY_RE = /^[0-9a-f]{66}$/;

function authDomain(): string {
  return (
    process.env.AUTH_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") ||
    "unipadnfts.vercel.app"
  );
}

function jwtSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET || "dev-only-change-me-unipad";
  return new TextEncoder().encode(raw);
}

function sessionTtlSeconds(): number {
  // Default 30 days — short TTLs left users "signed in" in the UI with dead JWTs.
  const fallback = 60 * 60 * 24 * 30;
  const n = Number(process.env.SESSION_TTL_SECONDS ?? fallback);
  if (!Number.isFinite(n) || n < 60) return fallback;
  return Math.floor(n);
}

/**
 * Stateless challenge: nonce is a short-lived signed JWT carrying challenge fields
 * so we don't need Postgres on Vercel for Sphere sign-in.
 */
export async function issueChallenge(chainPubkeyRaw: string) {
  const chainPubkey = chainPubkeyRaw.toLowerCase();
  if (!CHAIN_PUBKEY_RE.test(chainPubkey)) {
    throw Object.assign(
      new Error(
        "chainPubkey must be a 66-char lowercase-hex compressed secp256k1 public key",
      ),
      { status: 400, code: "UPAD_VALIDATION" },
    );
  }

  const domain = authDomain();
  const jti = nanoid(24);
  const now = Date.now();
  const ttlSeconds = 5 * 60;
  const built = buildChallenge({
    chainPubkey,
    domain,
    now,
    nonce: jti,
    ttlSeconds,
  });

  const nonce = await new SignJWT({
    purpose: "unipad-auth-challenge",
    chainPubkey,
    domain,
    jti,
    issuedAt: built.issuedAt,
    expiresAt: built.expiresAt,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setJti(jti)
    .sign(jwtSecret());

  return {
    nonce,
    challenge: built.challenge,
    expiresAt: built.expiresAt,
  };
}

export async function verifyChallenge(nonce: string, signature: string) {
  let payload: {
    purpose?: string;
    chainPubkey?: string;
    domain?: string;
    jti?: string;
    issuedAt?: number;
    expiresAt?: number;
  };

  try {
    const verified = await jwtVerify(nonce, jwtSecret());
    payload = verified.payload as typeof payload;
  } catch {
    throw Object.assign(new Error("Unknown or already-used nonce"), {
      status: 401,
      code: "UPAD_UNAUTHORIZED",
    });
  }

  if (payload.purpose !== "unipad-auth-challenge") {
    throw Object.assign(new Error("Invalid challenge token"), {
      status: 401,
      code: "UPAD_UNAUTHORIZED",
    });
  }

  const chainPubkey = payload.chainPubkey;
  const domain = payload.domain;
  const jti = payload.jti;
  const issuedAt = Number(payload.issuedAt);
  const expiresAt = Number(payload.expiresAt);

  if (!chainPubkey || !domain || !jti || !issuedAt || !expiresAt) {
    throw Object.assign(new Error("Malformed challenge"), {
      status: 401,
      code: "UPAD_UNAUTHORIZED",
    });
  }

  if (Date.now() > expiresAt) {
    throw Object.assign(new Error("Challenge expired"), {
      status: 401,
      code: "UPAD_UNAUTHORIZED",
    });
  }

  const challenge = reconstructChallenge({
    chainPubkey,
    domain,
    nonce: jti,
    issuedAt,
    expiresAt,
  });

  let recovered: string;
  try {
    recovered = recoverPubkeyFromSignature(challenge, signature);
  } catch (err) {
    throw Object.assign(
      new Error(`Malformed signature: ${(err as Error).message}`),
      { status: 401, code: "UPAD_UNAUTHORIZED" },
    );
  }

  if (!verifySignedMessage(challenge, signature, recovered)) {
    throw Object.assign(new Error("Signature verification failed"), {
      status: 401,
      code: "UPAD_UNAUTHORIZED",
    });
  }

  if (recovered.toLowerCase() !== chainPubkey.toLowerCase()) {
    throw Object.assign(new Error("Signature pubkey mismatch"), {
      status: 401,
      code: "UPAD_UNAUTHORIZED",
    });
  }

  const expiresIn = sessionTtlSeconds();
  const principal = recovered.toLowerCase();
  const token = await new SignJWT({ sub: principal })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(jwtSecret());

  return {
    token,
    chainPubkey: principal,
    expiresIn,
    displayName: `0x${principal.slice(0, 8)}…${principal.slice(-4)}`,
  };
}
