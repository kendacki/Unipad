import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { nanoid } from "nanoid";
import { env } from "../env.js";
import { query } from "../db/pool.js";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function saveMediaUpload(params: {
  uploaderPrincipal: string;
  collectionId?: string | null;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}) {
  if (!ALLOWED.has(params.mimeType)) {
    throw Object.assign(new Error("Unsupported media type"), { status: 400 });
  }
  if (params.bytes.length > MAX_BYTES) {
    throw Object.assign(new Error("File exceeds 8MB limit"), { status: 400 });
  }

  const contentHash = createHash("sha256").update(params.bytes).digest("hex");
  const existing = await query<{ public_url: string; id: string }>(
    `SELECT id, public_url FROM media_assets WHERE content_hash = $1`,
    [contentHash],
  );
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id,
      url: existing.rows[0].public_url,
      contentHash,
      deduped: true,
    };
  }

  await mkdir(env.uploadDir, { recursive: true });
  const ext = extname(params.filename) || mimeExt(params.mimeType);
  const stored = `${contentHash.slice(0, 16)}_${nanoid(8)}${ext}`;
  const localPath = join(env.uploadDir, stored);
  await writeFile(localPath, params.bytes);

  const publicUrl = `${env.publicApiUrl}/uploads/${stored}`;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO media_assets (
       collection_id, uploader_principal, content_hash, filename,
       mime_type, size_bytes, local_path, public_url
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      params.collectionId ?? null,
      params.uploaderPrincipal,
      contentHash,
      params.filename,
      params.mimeType,
      params.bytes.length,
      localPath,
      publicUrl,
    ],
  );

  return { id: rows[0].id, url: publicUrl, contentHash, deduped: false };
}

function mimeExt(mime: string) {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".jpg";
  }
}
