import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, submitRun, PLACEHOLDER_PLAYER } from "./api.ts";

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, reqInit: RequestInit) => {
    calls.push({ url, init: reqInit });
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("createSession POSTs the player to /api/session", async () => {
  const { fn, calls } = stubFetch({ runId: "0x1", seed: 7, issuedAt: 1 }, { status: 201 });
  const out = await createSession(PLACEHOLDER_PLAYER, fn);
  assert.equal(out.seed, 7);
  assert.equal(calls[0]!.url, "/api/session");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { player: PLACEHOLDER_PLAYER, identity: PLACEHOLDER_PLAYER });
});

test("createSession throws when the response is not ok", async () => {
  const { fn } = stubFetch({ error: "bad" }, { ok: false, status: 500 });
  await assert.rejects(() => createSession(PLACEHOLDER_PLAYER, fn));
});

test("submitRun POSTs runId+inputs and returns the settle body even on 409", async () => {
  const { fn, calls } = stubFetch({ status: "rejected", reason: "replay" }, { ok: false, status: 409 });
  const out = await submitRun("0xrun", [{ tick: 0, dir: 1 }], fn);
  assert.equal(out.status, "rejected");
  assert.equal(calls[0]!.url, "/api/settle");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { runId: "0xrun", inputs: [{ tick: 0, dir: 1 }] });
});
