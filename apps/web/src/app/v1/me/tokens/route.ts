import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import {
  MintHttpError,
  bindNametag,
  claimNametagTokens,
  listWalletTokens,
} from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated mint inventory for the connected wallet.
 * Claims tokens sent to this wallet's Sphere @nametag onto the session pubkey.
 * Will not steal a nametag already bound to a different pubkey.
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const nametag = new URL(request.url).searchParams.get("nametag");

    if (nametag) {
      try {
        // bindNametag refuses to overwrite another wallet's binding.
        await bindNametag(nametag, session.principal);
        await claimNametagTokens(session.principal, nametag);
      } catch (err) {
        console.error("nametag bind/claim failed", err);
      }
    }

    const tokens = await listWalletTokens(session.principal, {
      nametag,
      forceScan: true,
    });
    return NextResponse.json(
      {
        principal: session.principal,
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
