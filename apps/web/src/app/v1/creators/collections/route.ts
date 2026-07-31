import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth/requireAuth";
import {
  ListingHttpError,
  createListing,
  listCreatorListings,
} from "@/lib/listingStore";
import type { CreateCollectionInput } from "@unipad/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const collections = await listCreatorListings(session.principal);
    return NextResponse.json({ collections });
  } catch (err) {
    return handleErr(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth(request.headers.get("Authorization"));
    const body = (await request.json()) as CreateCollectionInput;
    const created = await createListing(session.principal, body);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleErr(err);
  }
}
