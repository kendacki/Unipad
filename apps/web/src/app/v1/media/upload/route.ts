import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client upload handshake for seller cover images (Vercel Blob).
 * Launch UI calls `@vercel/blob/client` upload() against this URL.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error: "Blob storage is not configured (BLOB_READ_WRITE_TOKEN)",
        code: "UPAD_BLOB_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        maximumSizeInBytes: 8 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ purpose: "cover" }),
      }),
      onUploadCompleted: async () => {
        /* Cover URL is returned to the client; collection create stores it. */
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message, code: "UPAD_BLOB_ERROR" }, { status: 400 });
  }
}
