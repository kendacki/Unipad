/**
 * Persistent object store for Unipad JSON ledgers + media.
 *
 * Pathnames stay identical to the former Vercel Blob layout, e.g.:
 *   listings/collections/{id}.json
 *   mints/tokens/{collectionId}/{tokenId}.json
 *   earnings/creators/{principal}/{id}.json
 *
 * Prefer Supabase (Postgres JSON rows + Storage for covers) when configured.
 * Falls back to Vercel Blob only if Supabase env is missing.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { del, list, put } from "@vercel/blob";

const OBJECTS_TABLE = process.env.SUPABASE_OBJECTS_TABLE?.trim() || "unipad_objects";
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET?.trim() || "unipad-media";

export type ListedObject = {
  pathname: string;
  url: string;
};

function supabaseUrl(): string | null {
  const url =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  return url || null;
}

export function usesSupabaseStore(): boolean {
  return Boolean(supabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function usesBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/** True when either Supabase or Vercel Blob can persist data. */
export function isPersistentStoreConfigured(): boolean {
  return usesSupabaseStore() || usesBlobStore();
}

let cachedClient: SupabaseClient | null = null;

function supabaseAdmin(): SupabaseClient {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

function publicObjectUrl(pathname: string): string {
  const base = supabaseUrl()?.replace(/\/$/, "") || "";
  // Synthetic URL for callers that previously used blob.url — body is loaded via getJson.
  return `${base}/storage/v1/object/public/${OBJECTS_TABLE}/${pathname}`;
}

export async function putJson(pathname: string, data: unknown): Promise<void> {
  if (usesSupabaseStore()) {
    const row = {
      pathname,
      body: data as object,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin().from(OBJECTS_TABLE).upsert(row, {
      onConflict: "pathname",
    });
    if (error) {
      throw new Error(`Supabase putJson failed (${pathname}): ${error.message}`);
    }
    return;
  }

  if (!usesBlobStore()) {
    throw new Error("No persistent store configured (Supabase or BLOB_READ_WRITE_TOKEN)");
  }

  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

/**
 * Write only if pathname does not exist (supply-slot / mint token races).
 * Throws when the object already exists and overwrite is not allowed.
 */
export async function putJsonExclusive(pathname: string, data: unknown): Promise<void> {
  if (usesSupabaseStore()) {
    const row = {
      pathname,
      body: data as object,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin().from(OBJECTS_TABLE).insert(row);
    if (error) {
      // 23505 unique_violation
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        throw new Error(`Object already exists: ${pathname}`);
      }
      throw new Error(`Supabase putJsonExclusive failed (${pathname}): ${error.message}`);
    }
    return;
  }

  if (!usesBlobStore()) {
    throw new Error("No persistent store configured (Supabase or BLOB_READ_WRITE_TOKEN)");
  }

  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function getJson<T>(pathname: string): Promise<T | null> {
  if (usesSupabaseStore()) {
    const { data, error } = await supabaseAdmin()
      .from(OBJECTS_TABLE)
      .select("body")
      .eq("pathname", pathname)
      .maybeSingle();
    if (error) {
      throw new Error(`Supabase getJson failed (${pathname}): ${error.message}`);
    }
    if (!data) return null;
    return data.body as T;
  }

  if (!usesBlobStore()) return null;

  const { blobs } = await list({
    prefix: pathname,
    limit: 1,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  const hit = blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  const url = `${hit.url}${hit.url.includes("?") ? "&" : "?"}_=${Date.now()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function listJsonUnder<T>(prefix: string): Promise<T[]> {
  if (usesSupabaseStore()) {
    const out: T[] = [];
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin()
        .from(OBJECTS_TABLE)
        .select("pathname, body")
        .like("pathname", `${prefix}%`)
        .order("pathname", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        throw new Error(`Supabase listJsonUnder failed (${prefix}): ${error.message}`);
      }
      if (!data?.length) break;
      for (const row of data) {
        if (!String(row.pathname || "").endsWith(".json")) continue;
        out.push(row.body as T);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  if (!usesBlobStore()) return [];

  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix,
      cursor,
      limit: 1000,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith(".json")) continue;
      const url = `${blob.url}${blob.url.includes("?") ? "&" : "?"}_=${Date.now()}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (!res.ok) continue;
      out.push((await res.json()) as T);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** List pathnames under a prefix (for counting / index cleanup). */
export async function listPathnames(prefix: string): Promise<ListedObject[]> {
  if (usesSupabaseStore()) {
    const out: ListedObject[] = [];
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin()
        .from(OBJECTS_TABLE)
        .select("pathname")
        .like("pathname", `${prefix}%`)
        .order("pathname", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        throw new Error(`Supabase listPathnames failed (${prefix}): ${error.message}`);
      }
      if (!data?.length) break;
      for (const row of data) {
        if (!row.pathname) continue;
        out.push({ pathname: row.pathname, url: publicObjectUrl(row.pathname) });
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  if (!usesBlobStore()) return [];

  const out: ListedObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix,
      cursor,
      limit: 1000,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    for (const blob of page.blobs) {
      out.push({ pathname: blob.pathname, url: blob.url });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function removeObject(pathname: string): Promise<void> {
  if (usesSupabaseStore()) {
    const { error } = await supabaseAdmin().from(OBJECTS_TABLE).delete().eq("pathname", pathname);
    if (error) {
      throw new Error(`Supabase removeObject failed (${pathname}): ${error.message}`);
    }
    return;
  }

  if (!usesBlobStore()) return;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    await del(pathname, { token });
  } catch {
    try {
      const { blobs } = await list({ prefix: pathname, limit: 10, token });
      for (const blob of blobs) {
        if (blob.pathname === pathname) {
          await del(blob.url, { token });
        }
      }
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Upload a cover/image to Supabase Storage (public bucket) or Vercel Blob.
 * Returns a public HTTPS URL suitable for collection.coverUrl.
 */
export async function uploadMediaFile(input: {
  filename: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
  contentType: string;
}): Promise<{ pathname: string; url: string }> {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "cover";
  const pathname = `covers/${Date.now()}-${safeName}`;

  const body =
    input.bytes instanceof Buffer
      ? input.bytes
      : Buffer.from(input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : input.bytes);

  if (usesSupabaseStore()) {
    const client = supabaseAdmin();

    const { error } = await client.storage.from(MEDIA_BUCKET).upload(pathname, body, {
      contentType: input.contentType || "application/octet-stream",
      upsert: true,
      cacheControl: "3600",
    });
    if (error) {
      throw new Error(`Supabase media upload failed: ${error.message}`);
    }
    const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(pathname);
    return { pathname, url: data.publicUrl };
  }

  if (!usesBlobStore()) {
    throw new Error("No media store configured (Supabase or BLOB_READ_WRITE_TOKEN)");
  }

  const result = await put(pathname, body, {
    access: "public",
    addRandomSuffix: true,
    contentType: input.contentType || "application/octet-stream",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { pathname: result.pathname, url: result.url };
}

export function mediaBucketName(): string {
  return MEDIA_BUCKET;
}

export function objectsTableName(): string {
  return OBJECTS_TABLE;
}
