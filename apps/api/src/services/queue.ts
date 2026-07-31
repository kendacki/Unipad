import { bus } from "../ws/bus.js";
import { query } from "../db/pool.js";
import { env } from "../env.js";

type Job<T> = {
  wallet: string;
  idempotencyKey: string;
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

const waiting: Job<unknown>[] = [];
let active = 0;

function publishPositions() {
  waiting.forEach((job, i) => {
    const position = i + 1;
    void query(
      `UPDATE mint_intents SET status = 'queued', queue_position = $2, updated_at = now()
       WHERE idempotency_key = $1 AND status IN ('payment_received', 'queued', 'awaiting_payment')`,
      [job.idempotencyKey, position],
    ).catch(() => undefined);
    bus.publish(`wallet:${job.wallet}`, {
      type: "queue.position",
      idempotencyKey: job.idempotencyKey,
      queuePosition: position,
    });
  });
}

function pump() {
  while (active < env.mintConcurrency && waiting.length) {
    const job = waiting.shift()!;
    active += 1;
    publishPositions();
    bus.publish(`wallet:${job.wallet}`, {
      type: "queue.position",
      idempotencyKey: job.idempotencyKey,
      queuePosition: 0,
    });
    void query(
      `UPDATE mint_intents SET status = 'minting', queue_position = 0, updated_at = now()
       WHERE idempotency_key = $1`,
      [job.idempotencyKey],
    ).catch(() => undefined);

    job
      .run()
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

/** Fair admission queue with visible queue.position (audit §9.2 / WS). */
export function enqueueMintSettlement<T>(
  wallet: string,
  idempotencyKey: string,
  run: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({
      wallet,
      idempotencyKey,
      run: run as () => Promise<unknown>,
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    publishPositions();
    pump();
  });
}

export function queueDepth() {
  return { waiting: waiting.length, active };
}
