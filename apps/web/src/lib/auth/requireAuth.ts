import { jwtVerify } from "jose";

function jwtSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET || "dev-only-change-me-unipad";
  return new TextEncoder().encode(raw);
}

export class AuthError extends Error {
  status = 401;
  code = "UPAD_UNAUTHORIZED";
  constructor(message: string) {
    super(message);
  }
}

/** Verify Bearer session JWT issued by /v1/auth/verify. */
export async function requireAuth(authorization: string | null | undefined) {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new AuthError("Missing bearer token");
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    const sub = payload.sub;
    if (!sub) throw new AuthError("Invalid token");
    return { principal: sub, mock: Boolean(payload.mock) };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("Invalid or expired session");
  }
}
