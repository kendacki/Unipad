import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import { ListingHttpError, replaceListingPhases } from "@/lib/listingStore";
import type { CreateCollectionInput } from "@unipad/shared";

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

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const { id } = await ctx.params;
    const body = (await request.json()) as { phases?: CreateCollectionInput["phases"] };
    if (!body.phases?.length) {
      return NextResponse.json(
        { error: "phases required", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }
    const updated = await replaceListingPhases(session.principal, id, body.phases);
    return NextResponse.json(updated);
  } catch (err) {
    return handleErr(err);
  }
}
