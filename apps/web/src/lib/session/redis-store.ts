// redis-store.ts — production SessionStore on Upstash Redis (REST). Used across
// serverless instances where the in-memory store cannot share state.
//
// Two correctness concerns drive the design:
//   1. consume() must be atomic across concurrent settle calls — done with a Lua
//      script that flips `used` only if it is currently unset (single-use guard).
//   2. Daily totals are G$ wei (up to ~1e18+), which exceed JS's safe-integer
//      range. We disable Upstash auto-deserialization so every value crosses the
//      wire as a string and is parsed with BigInt — no float ever touches the
//      amount. INCRBY happens server-side in Redis (int64), so the per-identity
//      daily cap must stay below int64 max (~9.22 G$/day), which the reward tier
//      respects.
import { Redis } from "@upstash/redis";
import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import type { CreateSessionInput, SessionRecord, SessionStore } from "./store.ts";

const SESSION_PREFIX = "sess:";
const DAILY_PREFIX = "daily:";
// Keep finished daily buckets around a little past midnight, then let them expire.
const DAILY_TTL_SECONDS = 60 * 60 * 36;

// Atomically mark a session used. Returns 1 only for the first caller; 0 if the
// session is missing/expired or already used.
const CONSUME_LUA = `
local used = redis.call('HGET', KEYS[1], 'used')
if used == false then return 0 end
if used == '1' then return 0 end
redis.call('HSET', KEYS[1], 'used', '1')
return 1
`;

// Increment a daily total by a decimal-string amount and (re)arm its TTL,
// returning the new total as a string so no JS double is involved.
const ADD_DAILY_LUA = `
local total = redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return tostring(total)
`;

function freshRunId(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

function freshSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

export interface RedisStoreOptions {
  url: string;
  token: string;
}

export function createRedisStore(opts: RedisStoreOptions): SessionStore {
  // automaticDeserialization:false => every value is a raw string, so large
  // bigint wei totals survive the round trip intact.
  const redis = new Redis({
    url: opts.url,
    token: opts.token,
    automaticDeserialization: false,
  });

  const sessionKey = (runId: string) => `${SESSION_PREFIX}${runId}`;
  const dailyKey = (identity: string, dayKey: string) =>
    `${DAILY_PREFIX}${identity}:${dayKey}`;

  return {
    async create(input: CreateSessionInput): Promise<SessionRecord> {
      const record: SessionRecord = {
        runId: freshRunId(),
        seed: freshSeed(),
        player: input.player,
        identity: input.identity,
        issuedAt: Date.now(),
        used: false,
      };
      const key = sessionKey(record.runId);
      await redis.hset(key, {
        runId: record.runId,
        seed: String(record.seed),
        player: record.player,
        identity: record.identity,
        issuedAt: String(record.issuedAt),
        used: "0",
      });
      // ttlMs:0 (or less) means immediately expired — never store it.
      if (input.ttlMs > 0) {
        await redis.pexpire(key, input.ttlMs);
      } else {
        await redis.del(key);
      }
      return record;
    },

    async get(runId: string): Promise<SessionRecord | null> {
      const h = await redis.hgetall<Record<string, string>>(sessionKey(runId));
      if (!h || Object.keys(h).length === 0) return null;
      return {
        runId: h.runId as Hex,
        seed: Number(h.seed),
        player: h.player as Address,
        identity: h.identity!,
        issuedAt: Number(h.issuedAt),
        used: h.used === "1",
      };
    },

    async consume(runId: string): Promise<boolean> {
      const r = await redis.eval(CONSUME_LUA, [sessionKey(runId)], []);
      return Number(r) === 1;
    },

    async getDailyTotal(identity: string, dayKey: string): Promise<bigint> {
      const v = await redis.get<string>(dailyKey(identity, dayKey));
      return v ? BigInt(v) : 0n;
    },

    async addDailyTotal(identity: string, dayKey: string, amount: bigint): Promise<bigint> {
      const total = await redis.eval(
        ADD_DAILY_LUA,
        [dailyKey(identity, dayKey)],
        [amount.toString(), String(DAILY_TTL_SECONDS)],
      );
      return BigInt(total as string);
    },
  };
}
