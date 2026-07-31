import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ principal: string }> };

/** Wallet mint inventory — empty until settlement DB is hosted on Vercel. */
export async function GET(_request: Request, ctx: Ctx) {
  const { principal } = await ctx.params;
  if (!principal) {
    return NextResponse.json(
      { error: "principal required", code: "UPAD_VALIDATION" },
      { status: 400 },
    );
  }
  return NextResponse.json({ tokens: [] });
}
