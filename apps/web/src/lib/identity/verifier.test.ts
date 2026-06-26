// verifier.test.ts — the identity gate's two implementations. The fake covers the
// verified / unverified / linked-root cases and proves it records who it was
// asked about (used elsewhere to assert sub-bar runs skip the RPC). The on-chain
// verifier is exercised against an injected viem transport — no network — to
// prove it maps a non-zero `getWhitelistedRoot` result to verified+root and the
// zero address to unverified.
import { test } from "node:test";
import assert from "node:assert/strict";
import { custom, encodeAbiParameters, zeroAddress, type Address } from "viem";
import { createFakeVerifier } from "./fake-verifier.ts";
import { createOnchainVerifier } from "./onchain-verifier.ts";

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const ROOT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

// A transport that answers eth_call with a single ABI-encoded address, so
// readContract decodes it offline.
function transportReturning(addr: Address) {
  return custom({
    async request({ method }) {
      if (method === "eth_chainId") return "0xa4ec"; // 42220
      if (method === "eth_call") return encodeAbiParameters([{ type: "address" }], [addr]);
      throw new Error(`unexpected RPC method ${method}`);
    },
  });
}

test("fake: a mapped player is verified with that root", async () => {
  const v = createFakeVerifier({ roots: { [ALICE.toLowerCase()]: ROOT } });
  const r = await v.check(ALICE);
  assert.equal(r.verified, true);
  assert.equal(r.root, ROOT.toLowerCase());
});

test("fake: linked wallets resolve to the same root", async () => {
  const v = createFakeVerifier({
    roots: { [ALICE.toLowerCase()]: ROOT, [BOB.toLowerCase()]: ROOT },
  });
  assert.equal((await v.check(ALICE)).root, (await v.check(BOB)).root);
});

test("fake: an unknown player is unverified, and selfRoot makes it its own root", async () => {
  assert.equal((await createFakeVerifier().check(ALICE)).verified, false);
  const dev = await createFakeVerifier({ selfRoot: true }).check(ALICE);
  assert.equal(dev.verified, true);
  assert.equal(dev.root, ALICE.toLowerCase());
});

test("fake: records every player it is asked about", async () => {
  const v = createFakeVerifier();
  await v.check(ALICE);
  await v.check(BOB);
  assert.deepEqual(v.calls, [ALICE, BOB]);
});

test("onchain: a non-zero getWhitelistedRoot means verified, lowercased root", async () => {
  const v = createOnchainVerifier({
    transport: transportReturning(ROOT),
    contract: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
  });
  const r = await v.check(ALICE);
  assert.equal(r.verified, true);
  assert.equal(r.root, ROOT.toLowerCase());
});

test("onchain: the zero address means unverified", async () => {
  const v = createOnchainVerifier({
    transport: transportReturning(zeroAddress),
    contract: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
  });
  const r = await v.check(ALICE);
  assert.equal(r.verified, false);
  assert.equal(r.root, "");
});
