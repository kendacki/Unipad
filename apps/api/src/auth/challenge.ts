/**
 * Challenge formatting — identical build/reconstruct path (Sphere backend-auth pattern).
 */

export interface ChallengeRecord {
  chainPubkey: string;
  domain: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

function formatChallenge(fields: ChallengeRecord): string {
  return [
    "Sign in to Unipad",
    "",
    `Domain: ${fields.domain}`,
    `Chain Pubkey: ${fields.chainPubkey}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${new Date(fields.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(fields.expiresAt).toISOString()}`,
  ].join("\n");
}

export function buildChallenge(params: {
  chainPubkey: string;
  domain: string;
  now: number;
  nonce: string;
  ttlSeconds: number;
}) {
  const issuedAt = params.now;
  const expiresAt = params.now + params.ttlSeconds * 1000;
  const record: ChallengeRecord = {
    chainPubkey: params.chainPubkey,
    domain: params.domain,
    nonce: params.nonce,
    issuedAt,
    expiresAt,
  };
  return { challenge: formatChallenge(record), nonce: params.nonce, issuedAt, expiresAt };
}

export function reconstructChallenge(stored: ChallengeRecord): string {
  return formatChallenge(stored);
}
