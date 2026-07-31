import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seller create/list — minting on Vercel uses the live catalog.
 * Full creator publishing still needs the hosted API + Postgres.
 * Return a clear product message (not a bare HTML 404 → UPAD_UNAVAILABLE).
 */
function unavailable() {
  return NextResponse.json(
    {
      error:
        "Creating new drops on the live site needs the Unipad API host. You can still mint any live catalog drop with UCT.",
      code: "UPAD_UNAVAILABLE",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    await requireAuth(request.headers.get("Authorization"));
    return NextResponse.json({ collections: [] });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    return unavailable();
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth(request.headers.get("Authorization"));
    return unavailable();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    return unavailable();
  }
}
