import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { ListingHttpError, publishListing } from "@/lib/listingStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function handleErr(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
  }
  if (err instanceof ListingHttpError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status },
    );
  }
  return NextResponse.json(
    { error: (err as Error).message || "Failed", code: "UPAD_UNKNOWN" },
    { status: 500 },
  );
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const { id } = await ctx.params;
    const published = await publishListing(session.principal, id);
    return NextResponse.json(published, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return handleErr(err);
  }
}
