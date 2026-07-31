import { NextResponse } from "next/server";
import { listPublicCollections } from "@/lib/listingStore";
import { withLiveSupply } from "@/lib/mintStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  const collections = await Promise.all(
    (await listPublicCollections(status)).map((c) => withLiveSupply(c)),
  );
  return NextResponse.json({ collections });
}
