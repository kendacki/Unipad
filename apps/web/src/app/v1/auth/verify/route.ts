import { NextResponse } from "next/server";
import { verifyChallenge } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    nonce?: string;
    signature?: string;
  };
  if (!body.nonce || !body.signature) {
    return NextResponse.json(
      { error: "nonce and signature required", code: "UPAD_VALIDATION" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await verifyChallenge(body.nonce, body.signature));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 401;
    const code = (err as { code?: string }).code ?? "UPAD_UNAUTHORIZED";
    return NextResponse.json(
      { error: (err as Error).message, code },
      { status: status as 401 },
    );
  }
}
