import { NextResponse } from "next/server";
import { listWalletTokens } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ principal: string }> };

/** Wallet mint inventory from the serverless mint ledger. */
export async function GET(_request: Request, ctx: Ctx) {
  const { principal } = await ctx.params;
  if (!principal) {
    return NextResponse.json(
      { error: "principal required", code: "UPAD_VALIDATION" },
      { status: 400 },
    );
  }
  const tokens = await listWalletTokens(decodeURIComponent(principal));
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      collectionId: t.collectionId,
      collectionName: t.collectionName,
      slug: t.slug,
      coverUrl: t.coverUrl,
      tokenId: t.tokenId,
      mintTxRef: t.mintTxRef,
      mintedAt: t.mintedAt,
    })),
  });
}
