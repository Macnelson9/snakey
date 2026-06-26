// voucher.test.ts — the scorer signs an EIP-712 voucher that GameRewards.sol
// verifies on-chain before releasing G$ (CLAUDE.md settle flow step 4). These
// tests pin the wire format and prove the security properties the contract
// relies on: the signature recovers to the scorer, and any tampering with the
// voucher fields invalidates it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  VOUCHER_TYPES,
  buildVoucherDomain,
  signVoucher,
  recoverVoucherSigner,
  type Voucher,
} from "./voucher.ts";

// Well-known Anvil test key #0 — NEVER a real scorer key.
const SCORER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944b6b0be62e1b6b5a3f6e1e9f6c8b6a1e" as const;

const ctx = { chainId: 44787, verifyingContract: "0x1111111111111111111111111111111111111111" } as const;

const baseVoucher: Voucher = {
  player: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  runId: "0xabc0000000000000000000000000000000000000000000000000000000000001",
  amount: 1_500000000000000000n,
  deadline: 1_900_000_000n,
};

test("buildVoucherDomain binds name, version, chain and contract", () => {
  const d = buildVoucherDomain(ctx.chainId, ctx.verifyingContract);
  assert.equal(d.name, "GameRewards");
  assert.equal(d.version, "1");
  assert.equal(d.chainId, ctx.chainId);
  assert.equal(d.verifyingContract, ctx.verifyingContract);
});

test("VOUCHER_TYPES matches the on-chain struct field order and types", () => {
  assert.deepEqual(VOUCHER_TYPES.Voucher, [
    { name: "player", type: "address" },
    { name: "runId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ]);
});

test("a signed voucher recovers to the scorer address", async () => {
  const account = privateKeyToAccount(SCORER_PK);
  const { signature, signer } = await signVoucher(SCORER_PK, baseVoucher, ctx);
  assert.equal(signer, account.address);
  const recovered = await recoverVoucherSigner(baseVoucher, signature, ctx);
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test("signing is deterministic for identical inputs (RFC 6979)", async () => {
  const a = await signVoucher(SCORER_PK, baseVoucher, ctx);
  const b = await signVoucher(SCORER_PK, baseVoucher, ctx);
  assert.equal(a.signature, b.signature);
});

test("tampering with amount breaks recovery to the scorer", async () => {
  const account = privateKeyToAccount(SCORER_PK);
  const { signature } = await signVoucher(SCORER_PK, baseVoucher, ctx);
  const tampered: Voucher = { ...baseVoucher, amount: baseVoucher.amount * 1000n };
  const recovered = await recoverVoucherSigner(tampered, signature, ctx);
  assert.notEqual(recovered.toLowerCase(), account.address.toLowerCase());
});

test("the same voucher signed for a different chainId is not interchangeable", async () => {
  const { signature } = await signVoucher(SCORER_PK, baseVoucher, ctx);
  const recovered = await recoverVoucherSigner(baseVoucher, signature, {
    chainId: 42220,
    verifyingContract: ctx.verifyingContract,
  });
  const account = privateKeyToAccount(SCORER_PK);
  assert.notEqual(recovered.toLowerCase(), account.address.toLowerCase());
});
