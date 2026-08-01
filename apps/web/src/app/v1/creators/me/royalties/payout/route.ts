import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { applyCreatorPayout, EarningsHttpError } from "@/lib/earningsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Record a seller payout after Sphere UCT send succeeds. */
export async function POST(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const body = (await request.json().catch(() => ({}))) as {
      amountUct?: string;
      recipient?: string;
      paymentRef?: string | null;
    };

    const amountUct = String(body.amountUct ?? "").trim();
    const recipient = String(body.recipient ?? "").trim();
    if (!amountUct || !recipient) {
      return NextResponse.json(
        { error: "Amount and recipient are required", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }

    const result = await applyCreatorPayout(session.principal, {
      amountUct,
      recipient,
      paymentRef: body.paymentRef ?? null,
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 401 },
      );
    }
    if (err instanceof EarningsHttpError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message || "Payout failed", code: "UPAD_UNKNOWN" },
      { status: 500 },
    );
  }
}
