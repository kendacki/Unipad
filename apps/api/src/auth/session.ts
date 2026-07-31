import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { recoverPubkeyFromSignature, verifySignedMessage } from "@unicitylabs/sphere-sdk";
import { env } from "../env.js";
import { query } from "../db/pool.js";
import { buildChallenge, reconstructChallenge } from "./challenge.js";

const CHAIN_PUBKEY_RE = /^[0-9a-f]{66}$/;
const secret = new TextEncoder().encode(env.jwtSecret);

export async function issueChallenge(chainPubkey: string) {
  if (!CHAIN_PUBKEY_RE.test(chainPubkey)) {
    throw new Error(
      "chainPubkey must be a 66-char lowercase-hex compressed secp256k1 public key",
    );
  }

  const nonce = nanoid(24);
  const built = buildChallenge({
    chainPubkey,
    domain: env.authDomain,
    now: Date.now(),
    nonce,
    ttlSeconds: 5 * 60,
  });

  await query(
    `INSERT INTO auth_nonces (nonce, chain_pubkey, domain, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [built.nonce, chainPubkey, env.authDomain, built.issuedAt, built.expiresAt],
  );

  return {
    nonce: built.nonce,
    challenge: built.challenge,
    expiresAt: built.expiresAt,
  };
}

export async function verifyChallenge(nonce: string, signature: string) {
  const { rows } = await query<{
    nonce: string;
    chain_pubkey: string;
    domain: string;
    issued_at: string;
    expires_at: string;
  }>(`DELETE FROM auth_nonces WHERE nonce = $1 RETURNING *`, [nonce]);

  const stored = rows[0];
  if (!stored) throw new Error("Unknown or already-used nonce");
  if (Date.now() > Number(stored.expires_at)) throw new Error("Challenge expired");

  const challenge = reconstructChallenge({
    chainPubkey: stored.chain_pubkey,
    domain: stored.domain,
    nonce: stored.nonce,
    issuedAt: Number(stored.issued_at),
    expiresAt: Number(stored.expires_at),
  });

  let recovered: string;
  try {
    recovered = recoverPubkeyFromSignature(challenge, signature);
  } catch (err) {
    throw new Error(`Malformed signature: ${(err as Error).message}`);
  }

  if (!verifySignedMessage(challenge, signature, recovered)) {
    throw new Error("Signature verification failed");
  }

  const token = await new SignJWT({ sub: recovered })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.sessionTtlSeconds}s`)
    .sign(secret);

  await query(
    `INSERT INTO creators (principal, display_name)
     VALUES ($1, $2)
     ON CONFLICT (principal) DO NOTHING`,
    [recovered, `0x${recovered.slice(0, 8)}…${recovered.slice(-4)}`],
  );

  return {
    token,
    chainPubkey: recovered,
    expiresIn: env.sessionTtlSeconds,
  };
}

/** Dev-only mock session (no Sphere required). */
export async function mockSession(label = "creator") {
  if (!env.devMock) throw new Error("Mock auth disabled");
  const principal = `mock_${label}_${nanoid(10)}`;
  await query(
    `INSERT INTO creators (principal, display_name)
     VALUES ($1, $2)
     ON CONFLICT (principal) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [principal, label === "buyer" ? "Demo Buyer" : "Demo Creator"],
  );
  const token = await new SignJWT({ sub: principal, mock: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.sessionTtlSeconds}s`)
    .sign(secret);
  return {
    token,
    chainPubkey: principal,
    expiresIn: env.sessionTtlSeconds,
    displayName: label === "buyer" ? "Demo Buyer" : "Demo Creator",
  };
}

export async function requireAuth(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token");
  }
  const token = authorization.slice("Bearer ".length);
  try {
    const { payload } = await jwtVerify(token, secret);
    const sub = payload.sub;
    if (!sub) throw new AuthError("Invalid token");
    return { principal: sub, mock: Boolean(payload.mock) };
  } catch {
    throw new AuthError("Invalid or expired session");
  }
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
  }
}
