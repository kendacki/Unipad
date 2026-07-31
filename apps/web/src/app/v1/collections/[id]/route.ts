import { NextResponse } from "next/server";
import { getCatalogCollection } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const col = getCatalogCollection(id);
  if (!col) {
    return NextResponse.json({ error: "Not found", code: "UPAD_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(col);
}
