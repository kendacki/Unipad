import { NextResponse } from "next/server";
import { isPersistentStoreConfigured, uploadMediaFile, usesSupabaseStore } from "@/lib/objectStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Cover image upload for Launch.
 * Prefers Supabase Storage; falls back to Vercel Blob when Supabase is not configured.
 * Accepts multipart form field `file`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isPersistentStoreConfigured()) {
    return NextResponse.json(
      {
        error:
          "Storage is not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (preferred) or BLOB_READ_WRITE_TOKEN.",
        code: "UPAD_BLOB_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file required", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }
    const contentType = file.type || "application/octet-stream";
    if (!ALLOWED.has(contentType)) {
      return NextResponse.json(
        { error: "Use JPEG, PNG, WebP, or GIF", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Image must be 8MB or smaller", code: "UPAD_VALIDATION" },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadMediaFile({
      filename: file.name || "cover.jpg",
      bytes,
      contentType,
    });

    return NextResponse.json({
      id: uploaded.pathname,
      url: uploaded.url,
      contentHash: uploaded.pathname,
      deduped: false,
      store: usesSupabaseStore() ? "supabase" : "blob",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message, code: "UPAD_BLOB_ERROR" }, { status: 400 });
  }
}
