import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { getResolvedCollection } from "@/lib/listingStore";
import { withLiveSupply } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let viewer: string | null = null;
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    viewer = session.principal;
  } catch (err) {
    if (!(err instanceof AuthError)) {
      // Ignore invalid tokens for public published drops; drafts still stay private.
    }
  }

  const col = await getResolvedCollection(id, viewer);
  if (!col) {
    return NextResponse.json({ error: "Not found", code: "UPAD_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(await withLiveSupply(col), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
