import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight session check — used to detect expired / rotated JWT secrets. */
export async function GET(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    return NextResponse.json({
      principal: session.principal,
      mock: session.mock,
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
