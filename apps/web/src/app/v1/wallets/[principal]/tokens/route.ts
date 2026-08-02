import { NextResponse } from "next/server";
import { listWalletTokens } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ principal: string }> };

/**
 * Public read of wallet mint inventory.
 * Never claims nametags or mutates bindings — that only happens on authenticated /v1/me/tokens.
 */
export async function GET(request: Request, ctx: Ctx) {
  const { principal } = await ctx.params;
  if (!principal) {
    return NextResponse.json(
      { error: "principal required", code: "UPAD_VALIDATION" },
      { status: 400 },
    );
  }
  // nametag is display-only for matching pending @tag-owned rows — never triggers claim.
  const nametag = new URL(request.url).searchParams.get("nametag");
  const tokens = await listWalletTokens(decodeURIComponent(principal), {
    nametag,
    forceScan: true,
  });
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
