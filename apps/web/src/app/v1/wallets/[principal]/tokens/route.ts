import { NextResponse } from "next/server";
import { listWalletTokens } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ principal: string }> };

/** Wallet mint inventory from the serverless mint ledger. */
export async function GET(request: Request, ctx: Ctx) {
  const { principal } = await ctx.params;
  if (!principal) {
    return NextResponse.json(
      { error: "principal required", code: "UPAD_VALIDATION" },
      { status: 400 },
    );
  }
  const nametag = new URL(request.url).searchParams.get("nametag");
  const tokens = await listWalletTokens(decodeURIComponent(principal), { nametag });
  return NextResponse.json(
    {
      tokens: tokens.map((t) => ({
        collectionId: t.collectionId,
        collectionName: t.collectionName,
        slug: t.slug,
        coverUrl: t.coverUrl,
        tokenId: t.tokenId,
        mintTxRef: t.mintTxRef,
        mintedAt: t.mintedAt,
        ownerPrincipal: t.ownerPrincipal,
      })),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
