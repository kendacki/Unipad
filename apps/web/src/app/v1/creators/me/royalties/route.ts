import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { getCreatorEarnings } from "@/lib/earningsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seller earnings — drop sales + received transfers (Balance only). */
export async function GET(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const url = new URL(request.url);
    const nametag = url.searchParams.get("nametag");
    const data = await getCreatorEarnings(session.principal, nametag);
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
