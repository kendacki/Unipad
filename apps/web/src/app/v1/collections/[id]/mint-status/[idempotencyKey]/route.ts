import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { getMintStatus, MintHttpError } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; idempotencyKey: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const { idempotencyKey } = await ctx.params;
    return NextResponse.json(await getMintStatus(idempotencyKey, session.principal));
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    if (err instanceof MintHttpError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status as 400 },
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: (err as Error).message || "Server error", code: "UPAD_UNKNOWN" },
      { status: 500 },
    );
  }
}
