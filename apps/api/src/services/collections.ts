import { nanoid } from "nanoid";
import type {
  CreateCollectionInput,
  MintIntentResponse,
  MintResult,
  PhaseType,
} from "@unipad/shared";
import { UCT_COIN_ID } from "@unipad/shared";
import { env } from "../env.js";
import { pool, query } from "../db/pool.js";
import {
  mapCollection,
  mapPhase,
  pickActivePhase,
  type CollectionRow,
  type PhaseRow,
} from "./mappers.js";
import { bus } from "../ws/bus.js";
import { enqueueMintSettlement } from "./queue.js";

async function loadPhases(collectionId: string) {
  const { rows } = await query<PhaseRow>(
    `SELECT * FROM collection_phases WHERE collection_id = $1 ORDER BY sort_order ASC`,
    [collectionId],
  );
  return rows.map(mapPhase);
}

async function loadCollectionByIdOrSlug(idOrSlug: string) {
  const { rows } = await query<CollectionRow>(
    `SELECT c.*, COALESCE(cr.display_name, '') AS creator_display_name
     FROM collections c
     LEFT JOIN creators cr ON cr.principal = c.creator_principal
     WHERE c.id::text = $1 OR c.slug = $1
     LIMIT 1`,
    [idOrSlug],
  );
  const row = rows[0];
  if (!row) return null;
  const phases = await loadPhases(row.id);
  return mapCollection(row, phases);
}

export async function listCollections(status?: string) {
  const params: unknown[] = [];
  let where = `WHERE c.status IN ('live', 'scheduled', 'sold_out', 'ended')`;
  if (status) {
    params.push(status);
    where = `WHERE c.status = $1`;
  }
  const { rows } = await query<CollectionRow>(
    `SELECT c.*, COALESCE(cr.display_name, '') AS creator_display_name
     FROM collections c
     LEFT JOIN creators cr ON cr.principal = c.creator_principal
     ${where}
     ORDER BY COALESCE(c.launch_at, c.created_at) DESC`,
    params,
  );
  const out = [];
  for (const row of rows) {
    out.push(mapCollection(row, await loadPhases(row.id)));
  }
  return out;
}

export async function getCollection(idOrSlug: string) {
  return loadCollectionByIdOrSlug(idOrSlug);
}

export async function listCreatorCollections(principal: string) {
  const { rows } = await query<CollectionRow>(
    `SELECT c.*, COALESCE(cr.display_name, '') AS creator_display_name
     FROM collections c
     LEFT JOIN creators cr ON cr.principal = c.creator_principal
     WHERE c.creator_principal = $1
     ORDER BY c.created_at DESC`,
    [principal],
  );
  const out = [];
  for (const row of rows) {
    out.push(mapCollection(row, await loadPhases(row.id)));
  }
  return out;
}

export async function createCollection(principal: string, input: CreateCollectionInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO creators (principal, display_name)
       VALUES ($1, $2)
       ON CONFLICT (principal) DO NOTHING`,
      [principal, principal.startsWith("mock_") ? "Demo Creator" : `0x${principal.slice(0, 8)}`],
    );

    const { rows } = await client.query<CollectionRow>(
      `INSERT INTO collections (
         slug, name, description, creator_principal, cover_url,
         status, total_supply, royalty_bps, launch_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *, '' AS creator_display_name`,
      [
        input.slug,
        input.name,
        input.description,
        principal,
        input.coverUrl ?? null,
        input.launchAt ? "scheduled" : "draft",
        input.totalSupply,
        input.royaltyBps,
        input.launchAt ?? null,
      ],
    );
    const collection = rows[0];

    const phases = [];
    for (let i = 0; i < input.phases.length; i++) {
      const p = input.phases[i];
      const { rows: phaseRows } = await client.query<PhaseRow>(
        `INSERT INTO collection_phases (
           collection_id, type, name, price_uct, max_per_wallet,
           starts_at, ends_at, supply_cap, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          collection.id,
          p.type,
          p.name,
          p.priceUct,
          p.maxPerWallet,
          p.startsAt ?? null,
          p.endsAt ?? null,
          p.supplyCap ?? null,
          i,
        ],
      );
      phases.push(mapPhase(phaseRows[0]));
    }

    await client.query("COMMIT");
    return mapCollection(
      {
        ...collection,
        creator_display_name: principal.startsWith("mock_")
          ? "Demo Creator"
          : `0x${principal.slice(0, 8)}`,
      },
      phases,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function publishCollection(principal: string, id: string) {
  const { rows } = await query<CollectionRow>(
    `UPDATE collections
     SET status = 'live', launch_at = COALESCE(launch_at, now()), updated_at = now()
     WHERE id = $1 AND creator_principal = $2
     RETURNING *, '' AS creator_display_name`,
    [id, principal],
  );
  if (!rows[0]) throw Object.assign(new Error("Collection not found"), { status: 404 });
  const mapped = mapCollection(rows[0], await loadPhases(id));
  bus.publish(`collection:${id}`, { type: "phase.changed", collection: mapped });
  return mapped;
}

/** Audit: PATCH /v1/creators/collections/{id}/phases */
export async function replacePhases(
  principal: string,
  collectionId: string,
  phases: Array<{
    type: PhaseType;
    name: string;
    priceUct: string;
    maxPerWallet: number;
    startsAt?: string | null;
    endsAt?: string | null;
    supplyCap?: number | null;
  }>,
) {
  const col = await loadCollectionByIdOrSlug(collectionId);
  if (!col || col.creatorPrincipal !== principal) {
    throw Object.assign(new Error("Collection not found"), { status: 404 });
  }
  if (col.status === "sold_out") {
    throw Object.assign(new Error("Cannot edit phases on sold-out collection"), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM collection_phases WHERE collection_id = $1`, [col.id]);
    const mapped = [];
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const { rows } = await client.query<PhaseRow>(
        `INSERT INTO collection_phases (
           collection_id, type, name, price_uct, max_per_wallet,
           starts_at, ends_at, supply_cap, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          col.id,
          p.type,
          p.name,
          p.priceUct,
          p.maxPerWallet,
          p.startsAt ?? null,
          p.endsAt ?? null,
          p.supplyCap ?? null,
          i,
        ],
      );
      mapped.push(mapPhase(rows[0]));
    }
    await client.query(`UPDATE collections SET updated_at = now() WHERE id = $1`, [col.id]);
    await client.query("COMMIT");
    const updated = { ...col, phases: mapped, activePhase: pickActivePhase(mapped) };
    bus.publish(`collection:${col.id}`, { type: "phase.changed", collection: updated });
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertAllowlist(
  principal: string,
  collectionId: string,
  phaseId: string,
  entries: Array<{ walletPrincipal: string; maxMints?: number }>,
) {
  const col = await loadCollectionByIdOrSlug(collectionId);
  if (!col || col.creatorPrincipal !== principal) {
    throw Object.assign(new Error("Collection not found"), { status: 404 });
  }
  const phase = col.phases.find((p) => p.id === phaseId);
  if (!phase) throw Object.assign(new Error("Phase not found"), { status: 404 });
  if (phase.type !== "allowlist") {
    throw Object.assign(new Error("Phase is not an allowlist phase"), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const e of entries) {
      const wallet = e.walletPrincipal.trim();
      if (!wallet) continue;
      await client.query(
        `INSERT INTO allowlist_entries (collection_id, wallet_principal, phase_id, max_mints)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (collection_id, wallet_principal, phase_id)
         DO UPDATE SET max_mints = EXCLUDED.max_mints`,
        [col.id, wallet, phaseId, e.maxMints ?? 1],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return listAllowlist(principal, collectionId, phaseId);
}

export async function listAllowlist(principal: string, collectionId: string, phaseId?: string) {
  const col = await loadCollectionByIdOrSlug(collectionId);
  if (!col || col.creatorPrincipal !== principal) {
    throw Object.assign(new Error("Collection not found"), { status: 404 });
  }
  const params: unknown[] = [col.id];
  let sql = `SELECT wallet_principal, phase_id, max_mints FROM allowlist_entries WHERE collection_id = $1`;
  if (phaseId) {
    params.push(phaseId);
    sql += ` AND phase_id = $2`;
  }
  sql += ` ORDER BY wallet_principal`;
  const { rows } = await query<{
    wallet_principal: string;
    phase_id: string;
    max_mints: number;
  }>(sql, params);
  return rows.map((r) => ({
    walletPrincipal: r.wallet_principal,
    phaseId: r.phase_id,
    maxMints: r.max_mints,
  }));
}

export async function getCreatorRoyalties(principal: string) {
  const { rows } = await query<{
    id: string;
    sale_id: string;
    collection_id: string;
    collection_name: string;
    gross_uct: string;
    platform_fee_uct: string;
    creator_net_uct: string;
    payout_status: string;
    created_at: Date;
  }>(
    `SELECT r.*, c.name AS collection_name
     FROM royalty_ledger r
     JOIN collections c ON c.id = r.collection_id
     WHERE r.creator_principal = $1
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [principal],
  );

  let accrued = 0n;
  let paid = 0n;
  for (const r of rows) {
    const net = BigInt(r.creator_net_uct);
    if (r.payout_status === "paid") paid += net;
    else accrued += net;
  }

  return {
    summary: {
      accruedUct: accrued.toString(),
      paidUct: paid.toString(),
      platformFeeBps: env.platformFeeBps,
    },
    entries: rows.map((r) => ({
      id: r.id,
      saleId: r.sale_id,
      collectionId: r.collection_id,
      collectionName: r.collection_name,
      grossUct: r.gross_uct,
      platformFeeUct: r.platform_fee_uct,
      creatorNetUct: r.creator_net_uct,
      payoutStatus: r.payout_status,
      createdAt: r.created_at.toISOString(),
    })),
  };
}

export async function createMintIntent(
  walletPrincipal: string,
  collectionIdOrSlug: string,
): Promise<MintIntentResponse> {
  const collection = await loadCollectionByIdOrSlug(collectionIdOrSlug);
  if (!collection) throw Object.assign(new Error("Collection not found"), { status: 404 });
  if (collection.status !== "live" && collection.status !== "scheduled") {
    throw Object.assign(new Error("Collection is not mintable"), { status: 400 });
  }
  if (collection.remainingSupply <= 0) {
    throw Object.assign(new Error("Sold out"), { status: 409 });
  }

  const phase = pickActivePhase(collection.phases);
  if (!phase) throw Object.assign(new Error("No active mint phase"), { status: 400 });

  if (phase.type === "creator" && walletPrincipal !== collection.creatorPrincipal) {
    throw Object.assign(new Error("Creator phase — only the creator may mint"), { status: 403 });
  }

  const { rows: owned } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM mint_ledger
     WHERE collection_id = $1 AND owner_principal = $2`,
    [collection.id, walletPrincipal],
  );
  if (Number(owned[0]?.count ?? 0) >= phase.maxPerWallet) {
    throw Object.assign(new Error("Wallet mint cap reached for this phase"), { status: 403 });
  }

  if (phase.type === "allowlist") {
    const { rows: al } = await query<{ max_mints: number }>(
      `SELECT max_mints FROM allowlist_entries
       WHERE collection_id = $1 AND wallet_principal = $2 AND phase_id = $3`,
      [collection.id, walletPrincipal, phase.id],
    );
    if (!al.length) {
      throw Object.assign(new Error("Wallet not on allowlist"), { status: 403 });
    }
    if (Number(owned[0]?.count ?? 0) >= al[0].max_mints) {
      throw Object.assign(new Error("Allowlist mint cap reached"), { status: 403 });
    }
  }

  const idempotencyKey = nanoid(28);
  const paymentMemo = `unipad:${idempotencyKey}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await query(
    `INSERT INTO mint_intents (
       idempotency_key, collection_id, phase_id, wallet_principal,
       price_uct, payment_memo, status, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'awaiting_payment',$7)`,
    [
      idempotencyKey,
      collection.id,
      phase.id,
      walletPrincipal,
      phase.priceUct,
      paymentMemo,
      expiresAt.toISOString(),
    ],
  );

  return {
    idempotencyKey,
    collectionId: collection.id,
    phaseId: phase.id,
    priceUct: phase.priceUct,
    payment: {
      coinId: "UCT",
      coinIdHex: UCT_COIN_ID,
      amount: phase.priceUct,
      recipient: env.treasuryPrincipal,
      memo: paymentMemo,
    },
    expiresAt: expiresAt.toISOString(),
    nonce: nanoid(16),
  };
}

async function settleMintLocked(params: {
  walletPrincipal: string;
  collectionId: string;
  idempotencyKey: string;
  paymentRef: string;
}): Promise<MintResult> {
  const { walletPrincipal, collectionId, idempotencyKey, paymentRef } = params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: locked } = await client.query<{
      id: string;
      total_supply: number;
      minted_count: number;
      status: string;
      creator_principal: string;
      royalty_bps: number;
    }>(
      `SELECT id, total_supply, minted_count, status, creator_principal, royalty_bps
       FROM collections WHERE id = $1 FOR UPDATE`,
      [collectionId],
    );
    const col = locked[0];
    if (!col) throw Object.assign(new Error("Collection not found"), { status: 404 });
    if (col.minted_count >= col.total_supply) {
      await client.query(
        `UPDATE mint_intents SET status = 'rejected', reason = 'sold_out', updated_at = now()
         WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      await client.query("COMMIT");
      return { status: "rejected", idempotencyKey, reason: "sold_out" };
    }

    try {
      await client.query(
        `UPDATE mint_intents
         SET status = 'minting', payment_ref = $2, updated_at = now()
         WHERE idempotency_key = $1 AND status IN ('awaiting_payment', 'queued', 'payment_received', 'minting')`,
        [idempotencyKey, paymentRef],
      );
    } catch (err: unknown) {
      const msg = String((err as { message?: string })?.message ?? err);
      if (msg.includes("mint_intents_payment_ref_key") || msg.includes("duplicate key")) {
        await client.query("ROLLBACK");
        throw Object.assign(new Error("paymentRef already used"), { status: 409 });
      }
      throw err;
    }

    const { rows: intentRows } = await client.query<{
      price_uct: string;
      payment_memo: string;
      phase_id: string;
    }>(`SELECT price_uct, payment_memo, phase_id FROM mint_intents WHERE idempotency_key = $1`, [
      idempotencyKey,
    ]);
    const intentRow = intentRows[0];

    await client.query(
      `INSERT INTO payment_receipts (payment_ref, idempotency_key, wallet_principal, amount_uct, memo, verified)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (payment_ref) DO NOTHING`,
      [
        paymentRef,
        idempotencyKey,
        walletPrincipal,
        intentRow.price_uct,
        intentRow.payment_memo,
        env.devMock || paymentRef.startsWith("mock-uct:"),
      ],
    );

    const tokenId = col.minted_count + 1;
    const mintTxRef = `uct-mint:${collectionId}:${tokenId}:${nanoid(10)}`;

    const { rows: ledgerRows } = await client.query<{ id: string }>(
      `INSERT INTO mint_ledger (
         collection_id, token_id, owner_principal, mint_tx_ref,
         payment_ref, phase_id, price_uct
       )
       SELECT collection_id, $2, wallet_principal, $3, payment_ref, phase_id, price_uct
       FROM mint_intents WHERE idempotency_key = $1
       RETURNING id`,
      [idempotencyKey, tokenId, mintTxRef],
    );

    const saleId = ledgerRows[0].id;
    const gross = BigInt(intentRow.price_uct);
    const platformFee = (gross * BigInt(env.platformFeeBps)) / 10000n;
    const creatorNet = gross - platformFee;

    await client.query(
      `INSERT INTO royalty_ledger (
         sale_id, collection_id, creator_principal, gross_uct,
         platform_fee_uct, creator_net_uct, payout_status, payout_batch
       ) VALUES ($1,$2,$3,$4,$5,$6,'accrued','mint')
       ON CONFLICT (sale_id) DO NOTHING`,
      [
        saleId,
        collectionId,
        col.creator_principal,
        gross.toString(),
        platformFee.toString(),
        creatorNet.toString(),
      ],
    );

    await client.query(
      `UPDATE collections
       SET minted_count = minted_count + 1,
           status = CASE WHEN minted_count + 1 >= total_supply THEN 'sold_out' ELSE status END,
           updated_at = now()
       WHERE id = $1`,
      [collectionId],
    );

    await client.query(
      `UPDATE mint_intents
       SET status = 'confirmed', token_id = $2, mint_tx_ref = $3, queue_position = NULL, updated_at = now()
       WHERE idempotency_key = $1`,
      [idempotencyKey, tokenId, mintTxRef],
    );

    const result: MintResult = {
      status: "confirmed",
      idempotencyKey,
      tokenId,
      mintTxRef,
    };

    await client.query(
      `INSERT INTO idempotency_keys (idempotency_key, response_json)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (idempotency_key) DO UPDATE SET response_json = EXCLUDED.response_json`,
      [idempotencyKey, JSON.stringify(result)],
    );

    await client.query("COMMIT");

    const remaining = col.total_supply - (col.minted_count + 1);
    bus.publish(`collection:${collectionId}`, {
      type: "supply.updated",
      remainingSupply: remaining,
      mintedCount: col.minted_count + 1,
    });
    bus.publish(`collection:${collectionId}`, {
      type: "mint.confirmed",
      tokenId,
      ownerPrincipal: walletPrincipal,
    });
    bus.publish(`wallet:${walletPrincipal}`, {
      type: "mint.result",
      status: "confirmed",
      idempotencyKey,
      tokenId,
      mintTxRef,
    });

    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    const msg = String((err as { message?: string })?.message ?? err);
    if (msg.includes("mint_ledger_collection_id_token_id_key")) {
      return { status: "rejected", idempotencyKey, reason: "token_already_minted" };
    }
    if (msg.includes("mint_ledger_payment_ref_key")) {
      throw Object.assign(new Error("paymentRef already settled"), { status: 409 });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pay-then-mint with admission queue (audit §9.2).
 */
export async function submitMint(params: {
  walletPrincipal: string;
  collectionIdOrSlug: string;
  idempotencyKey: string;
  paymentRef: string;
}): Promise<MintResult> {
  const { walletPrincipal, collectionIdOrSlug, idempotencyKey, paymentRef } = params;

  const cached = await query<{ response_json: MintResult }>(
    `SELECT response_json FROM idempotency_keys WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  if (cached.rows[0]?.response_json) {
    return cached.rows[0].response_json;
  }

  const existing = await query<{
    status: string;
    token_id: number | null;
    mint_tx_ref: string | null;
    reason: string | null;
    queue_position: number | null;
    wallet_principal: string;
    price_uct: string;
    payment_memo: string;
  }>(`SELECT * FROM mint_intents WHERE idempotency_key = $1`, [idempotencyKey]);

  const intent = existing.rows[0];
  if (!intent) throw Object.assign(new Error("Unknown mint intent"), { status: 404 });
  if (intent.wallet_principal !== walletPrincipal) {
    throw Object.assign(new Error("Intent belongs to another wallet"), { status: 403 });
  }
  if (intent.status === "confirmed" && intent.token_id != null) {
    return {
      status: "confirmed",
      idempotencyKey,
      tokenId: intent.token_id,
      mintTxRef: intent.mint_tx_ref ?? undefined,
    };
  }

  if (!paymentRef?.trim()) {
    throw Object.assign(new Error("paymentRef required"), { status: 400 });
  }

  // Basic payment proof shape check (full Sphere oracle verification = Phase 1+)
  if (paymentRef.startsWith("mock-uct:") && !env.devMock) {
    throw Object.assign(new Error("Mock payments disabled"), { status: 400 });
  }
  if (paymentRef.startsWith("mock-uct:") && !paymentRef.includes(intent.payment_memo)) {
    throw Object.assign(new Error("Payment memo mismatch"), { status: 400 });
  }
  if (
    paymentRef.startsWith("sphere-pending:") &&
    !paymentRef.includes(intent.payment_memo)
  ) {
    throw Object.assign(new Error("Payment memo mismatch"), { status: 400 });
  }

  const collection = await loadCollectionByIdOrSlug(collectionIdOrSlug);
  if (!collection) throw Object.assign(new Error("Collection not found"), { status: 404 });

  await query(
    `UPDATE mint_intents
     SET status = 'payment_received', payment_ref = COALESCE(payment_ref, $2), updated_at = now()
     WHERE idempotency_key = $1 AND status = 'awaiting_payment'`,
    [idempotencyKey, paymentRef],
  );

  return enqueueMintSettlement(walletPrincipal, idempotencyKey, () =>
    settleMintLocked({
      walletPrincipal,
      collectionId: collection.id,
      idempotencyKey,
      paymentRef,
    }),
  );
}

export async function getMintStatus(idempotencyKey: string, walletPrincipal: string) {
  const { rows } = await query<{
    status: string;
    token_id: number | null;
    mint_tx_ref: string | null;
    reason: string | null;
    queue_position: number | null;
    wallet_principal: string;
  }>(`SELECT * FROM mint_intents WHERE idempotency_key = $1`, [idempotencyKey]);
  const row = rows[0];
  if (!row) throw Object.assign(new Error("Not found"), { status: 404 });
  if (row.wallet_principal !== walletPrincipal) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  return {
    status: row.status as MintResult["status"],
    idempotencyKey,
    tokenId: row.token_id ?? undefined,
    mintTxRef: row.mint_tx_ref ?? undefined,
    reason: row.reason ?? undefined,
    queuePosition: row.queue_position ?? undefined,
  } satisfies MintResult;
}

export async function listWalletTokens(principal: string) {
  const { rows } = await query<{
    collection_id: string;
    token_id: number;
    mint_tx_ref: string;
    minted_at: Date;
    name: string;
    slug: string;
    cover_url: string | null;
  }>(
    `SELECT m.collection_id, m.token_id, m.mint_tx_ref, m.minted_at,
            c.name, c.slug, c.cover_url
     FROM mint_ledger m
     JOIN collections c ON c.id = m.collection_id
     WHERE m.owner_principal = $1
     ORDER BY m.minted_at DESC`,
    [principal],
  );
  return rows.map((r) => ({
    collectionId: r.collection_id,
    collectionName: r.name,
    slug: r.slug,
    coverUrl: r.cover_url,
    tokenId: r.token_id,
    mintTxRef: r.mint_tx_ref,
    mintedAt: r.minted_at.toISOString(),
  }));
}
