import { NextResponse } from "next/server";
import { getResolvedCollection } from "@/lib/listingStore";
import { withLiveSupply } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const col = await getResolvedCollection(id);
  if (!col) {
    return NextResponse.json({ error: "Not found", code: "UPAD_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(await withLiveSupply(col));
}
