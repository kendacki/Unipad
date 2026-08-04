/**
 * Ensure every outbound payout has a matching inbound credit for the recipient tag.
 *   pnpm exec tsx scripts/heal-inbound-payouts.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), "../../.env"));

async function main() {
  const { listPathnames, getJson, putJson } = await import("../src/lib/objectStore.ts");
  const { creditInboundTransfer } = await import("../src/lib/earningsStore.ts");

  const sales = await listPathnames("earnings/sales/");
  const healed: unknown[] = [];

  for (const p of sales) {
    const row = (await getJson(p.pathname)) as {
      id?: string;
      entryKind?: string;
      payoutStatus?: string;
      payoutRecipient?: string | null;
      payoutSender?: string | null;
      payoutRef?: string | null;
      creatorNetUct?: string;
      creatorPrincipal?: string;
      saleId?: string;
    } | null;
    if (!row?.payoutRecipient || row.payoutStatus !== "paid") continue;
    if (row.entryKind === "inbound") continue;
    const paymentRef = row.payoutRef?.startsWith("inbound:")
      ? null
      : row.payoutRef?.trim();
    if (!paymentRef) continue;

    // Index payout ref for idempotent retries
    await putJson(`earnings/by-payout-ref/${encodeURIComponent(paymentRef).slice(0, 160)}.json`, {
      id: row.id,
    });

    const inbound = await creditInboundTransfer({
      recipientNametag: row.payoutRecipient,
      amountUct: row.creatorNetUct || "0",
      paymentRef,
      senderPrincipal: row.creatorPrincipal || "unknown",
      senderNametag: row.payoutSender,
    });
    healed.push({
      paymentRef,
      recipient: row.payoutRecipient,
      amount: row.creatorNetUct,
      inboundId: inbound?.id,
    });
  }

  console.log(JSON.stringify({ ok: true, healed }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
