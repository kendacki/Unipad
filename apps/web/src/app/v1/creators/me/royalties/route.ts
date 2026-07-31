import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { getCreatorEarnings } from "@/lib/earningsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seller earnings — primary mint sales net of platform fee. */
export async function GET(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const data = await getCreatorEarnings(session.principal);
    return NextResponse.json(data);
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
