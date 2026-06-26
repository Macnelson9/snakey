// memory-store.ts — in-process SessionStore for local dev and tests. Single-
// threaded JS makes consume() trivially atomic here. NOT for multi-instance
// production (state is per-process and lost on restart) — use the Redis store.
import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import type { CreateSessionInput, SessionRecord, SessionStore } from "./store.ts";

interface Entry {
  record: SessionRecord;
  expiresAt: number;
}

function freshRunId(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

function freshSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

export function createMemoryStore(
  now: () => number = Date.now,
  seedGen: () => number = freshSeed,
): SessionStore {
  const sessions = new Map<string, Entry>();
  const daily = new Map<string, bigint>();
  const dayBucket = (identity: string, dayKey: string) => `${identity}::${dayKey}`;

  const live = (runId: string): Entry | null => {
    const e = sessions.get(runId);
    if (!e) return null;
    if (now() >= e.expiresAt) {
      sessions.delete(runId);
      return null;
    }
    return e;
  };

  return {
    async create(input: CreateSessionInput): Promise<SessionRecord> {
      const issuedAt = now();
      const record: SessionRecord = {
        runId: freshRunId(),
        seed: seedGen() >>> 0,
        player: input.player as Address,
        issuedAt,
        used: false,
      };
      sessions.set(record.runId, { record, expiresAt: issuedAt + input.ttlMs });
      return { ...record };
    },

    async get(runId: string): Promise<SessionRecord | null> {
      const e = live(runId);
      return e ? { ...e.record } : null;
    },

    async consume(runId: string): Promise<boolean> {
      const e = live(runId);
      if (!e || e.record.used) return false;
      e.record.used = true;
      return true;
    },

    async getDailyTotal(identity: string, dayKey: string): Promise<bigint> {
      return daily.get(dayBucket(identity, dayKey)) ?? 0n;
    },

    async addDailyTotal(identity: string, dayKey: string, amount: bigint): Promise<bigint> {
      const key = dayBucket(identity, dayKey);
      const next = (daily.get(key) ?? 0n) + amount;
      daily.set(key, next);
      return next;
    },
  };
}
