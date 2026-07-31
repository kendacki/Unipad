import { NextResponse } from "next/server";
import { listCatalogCollections } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  return NextResponse.json({
    collections: listCatalogCollections(status),
  });
}
