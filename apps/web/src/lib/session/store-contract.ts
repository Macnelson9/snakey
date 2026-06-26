// store-contract.ts — behavioral contract every SessionStore implementation must
// satisfy. The in-memory store is verified against it now; the Upstash Redis
// store can be run against the identical suite once credentials are available,
// guaranteeing the two implementations are interchangeable. This is the stateful
// anti-replay / rate-limit layer that sits around the stateless verifier.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionStore } from "./store.ts";

const PLAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const IDENTITY = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

export function runStoreContract(
  name: string,
  makeStore: () => Promise<SessionStore> | SessionStore,
): void {
  test(`${name}: create issues a single-use, identity-bound session with a uint32 seed`, async () => {
    const store = await makeStore();
    const s = await store.create({ player: PLAYER, identity: IDENTITY, ttlMs: 60_000 });
    assert.match(s.runId, /^0x[0-9a-f]{64}$/, "runId is a bytes32 hex string");
    assert.ok(Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffff_ffff, "seed is uint32");
    assert.equal(s.used, false);
    assert.equal(s.identity, IDENTITY);
    assert.equal(s.player, PLAYER);
    assert.ok(s.issuedAt > 0);
  });

  test(`${name}: runIds and seeds differ across sessions (CSPRNG, not predictable)`, async () => {
    const store = await makeStore();
    const runIds = new Set<string>();
    const seeds = new Set<number>();
    for (let i = 0; i < 25; i++) {
      const s = await store.create({ player: PLAYER, identity: IDENTITY, ttlMs: 60_000 });
      runIds.add(s.runId);
      seeds.add(s.seed);
    }
    assert.equal(runIds.size, 25, "runIds must be unique");
    assert.ok(seeds.size >= 24, "seeds must be effectively unique");
  });

  test(`${name}: get returns the record, and null for unknown runId`, async () => {
    const store = await makeStore();
    const s = await store.create({ player: PLAYER, identity: IDENTITY, ttlMs: 60_000 });
    const got = await store.get(s.runId);
    assert.equal(got?.runId, s.runId);
    assert.equal(got?.seed, s.seed);
    assert.equal(await store.get("0x" + "de".repeat(32)), null);
  });

  test(`${name}: a session past its TTL is gone`, async () => {
    const store = await makeStore();
    const s = await store.create({ player: PLAYER, identity: IDENTITY, ttlMs: 0 });
    assert.equal(await store.get(s.runId), null, "ttlMs:0 means immediately expired");
  });

  test(`${name}: consume is single-use — succeeds once, fails every time after`, async () => {
    const store = await makeStore();
    const s = await store.create({ player: PLAYER, identity: IDENTITY, ttlMs: 60_000 });
    assert.equal(await store.consume(s.runId), true, "first consume wins");
    assert.equal(await store.consume(s.runId), false, "replay is rejected");
    assert.equal((await store.get(s.runId))?.used, true, "record reflects used");
  });

  test(`${name}: consume of an unknown runId fails`, async () => {
    const store = await makeStore();
    assert.equal(await store.consume("0x" + "ab".repeat(32)), false);
  });

  test(`${name}: daily totals accumulate per identity and per day, isolated`, async () => {
    const store = await makeStore();
    const day = "2026-06-24";
    assert.equal(await store.getDailyTotal(IDENTITY, day), 0n);
    assert.equal(await store.addDailyTotal(IDENTITY, day, 1_000n), 1_000n);
    assert.equal(await store.addDailyTotal(IDENTITY, day, 500n), 1_500n);
    assert.equal(await store.getDailyTotal(IDENTITY, day), 1_500n);
    // different day is a fresh bucket
    assert.equal(await store.getDailyTotal(IDENTITY, "2026-06-25"), 0n);
    // different identity is a fresh bucket
    assert.equal(await store.getDailyTotal("0xother", day), 0n);
  });
}
