import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { MintHttpError, transferToken } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Transfer a minted NFT in the Unipad ledger to another @nametag or chain pubkey. */
export async function POST(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const body = (await request.json().catch(() => ({}))) as {
      collectionId?: string;
      tokenId?: number;
      to?: string;
      nametag?: string;
    };

    if (!body.collectionId?.trim()) {
      return NextResponse.json(
        { error: "collectionId required", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }
    if (body.tokenId == null) {
      return NextResponse.json(
        { error: "tokenId required", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }
    if (!body.to?.trim()) {
      return NextResponse.json(
        { error: "Recipient required ( @nametag or chain pubkey )", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }

    const updated = await transferToken({
      fromPrincipal: session.principal,
      fromNametag: body.nametag ?? null,
      collectionId: body.collectionId.trim(),
      tokenId: Number(body.tokenId),
      toRecipient: body.to,
    });

    return NextResponse.json({
      ok: true,
      token: {
        collectionId: updated.collectionId,
        collectionName: updated.collectionName,
        slug: updated.slug,
        coverUrl: updated.coverUrl,
        tokenId: updated.tokenId,
        mintTxRef: updated.mintTxRef,
        mintedAt: updated.mintedAt,
        ownerPrincipal: updated.ownerPrincipal,
      },
    });
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
