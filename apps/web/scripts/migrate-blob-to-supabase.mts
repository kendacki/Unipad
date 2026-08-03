/**
 * Copy JSON objects from Vercel Blob → Supabase unipad_objects.
 *
 * Usage (from apps/web, with both stores configured):
 *   pnpm exec tsx scripts/migrate-blob-to-supabase.mts
 *
 * Safe to re-run (upserts by pathname). Does not delete Blob data.
 */
import { get, list } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";

const TABLE = process.env.SUPABASE_OBJECTS_TABLE?.trim() || "unipad_objects";
const PREFIXES = ["listings/", "mints/", "earnings/", "covers/"];

async function readBlobJson(pathname: string, url: string, token: string): Promise<unknown> {
  // Prefer authenticated SDK get — public CDN fetch often 403 when the store is full/suspended.
  try {
    const result = await get(pathname, { access: "public", token });
    if (result?.statusCode === 200 && result.stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
  } catch {
    /* fall through */
  }

  const res = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`fetch ${pathname} → ${res.status}`);
  }
  return res.json();
}

async function main() {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!blobToken) throw new Error("BLOB_READ_WRITE_TOKEN required to read source data");
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const prefix of PREFIXES) {
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix,
        cursor,
        limit: 500,
        token: blobToken,
      });
      for (const blob of page.blobs) {
        if (!blob.pathname.endsWith(".json")) {
          skipped += 1;
          continue;
        }
        try {
          const body = await readBlobJson(blob.pathname, blob.url, blobToken);
          const { error } = await supabase.from(TABLE).upsert(
            {
              pathname: blob.pathname,
              body,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "pathname" },
          );
          if (error) {
            failed += 1;
            console.error("upsert fail", blob.pathname, error.message);
          } else {
            copied += 1;
            if (copied % 10 === 0) console.log(`… ${copied} objects`);
          }
        } catch (e) {
          failed += 1;
          console.error("error", blob.pathname, e instanceof Error ? e.message : e);
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }

  console.log(JSON.stringify({ copied, skipped, failed }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
