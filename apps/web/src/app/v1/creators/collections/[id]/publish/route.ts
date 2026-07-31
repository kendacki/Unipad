import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function unavailable() {
  return NextResponse.json(
    {
      error:
        "Publishing drops on the live site needs the Unipad API host. Minting live catalog drops works now.",
      code: "UPAD_UNAVAILABLE",
    },
    { status: 503 },
  );
}

export async function POST(request: Request, _ctx: Ctx) {
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
