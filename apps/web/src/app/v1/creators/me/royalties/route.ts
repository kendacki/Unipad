import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creator earnings — empty until mint settlement is backed by hosted Postgres.
 * Still authenticates so signed-in creators see a clean zero state (not a 404).
 */
export async function GET(request: Request) {
  try {
    await requireAuth(request.headers.get("Authorization"));
    const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? 250);
    return NextResponse.json({
      summary: {
        accruedUct: "0",
        paidUct: "0",
        platformFeeBps,
      },
      entries: [],
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message, code: "UPAD_UNKNOWN" },
      { status: 500 },
    );
  }
}
