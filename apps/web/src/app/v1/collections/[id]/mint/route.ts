import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { MintHttpError, submitMint } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      idempotencyKey?: string;
      paymentRef?: string;
    };
    const key = request.headers.get("Idempotency-Key") ?? body.idempotencyKey;
    if (!key) {
      return NextResponse.json(
        { error: "Idempotency-Key required", code: "UPAD_IDEMPOTENCY" },
        { status: 400 },
      );
    }
    if (!body.paymentRef) {
      return NextResponse.json(
        { error: "paymentRef required", code: "UPAD_PAYMENT_REQUIRED" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await submitMint({
        walletPrincipal: session.principal,
        collectionIdOrSlug: id,
        idempotencyKey: key,
        paymentRef: body.paymentRef,
      }),
    );
  } catch (err) {
    return mintErrorResponse(err);
  }
}

function mintErrorResponse(err: unknown) {
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
