// voucher.ts — EIP-712 reward voucher. The scorer (the crown-jewel signer key,
// CLAUDE.md) signs { player, runId, amount, deadline }; GameRewards.sol verifies
// the signature against its trusted `scorer` address, checks the per-runId replay
// guard and deadline, then releases G$ to the player.
//
// The struct field order and types here MUST match the Solidity struct exactly,
// or recovered signatures will not match and redemptions will revert.
import {
  privateKeyToAccount,
} from "viem/accounts";
import {
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

export interface Voucher {
  player: Address;
  /** 32-byte run identifier, also the on-chain replay-guard key. */
  runId: Hex;
  /** Reward amount in G$ wei (18 decimals). */
  amount: bigint;
  /** Unix seconds after which the voucher is no longer redeemable. */
  deadline: bigint;
}

export interface VoucherContext {
  chainId: number;
  verifyingContract: Address;
}

// keccak256 of the struct is domain-separated by these fields, so a voucher is
// bound to exactly one chain and one GameRewards deployment.
export const VOUCHER_TYPES = {
  Voucher: [
    { name: "player", type: "address" },
    { name: "runId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function buildVoucherDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return {
    name: "GameRewards",
    version: "1",
    chainId,
    verifyingContract,
  };
}

export interface SignedVoucher {
  voucher: Voucher;
  signature: Hex;
  signer: Address;
}

/** Sign a voucher with the scorer key. Deterministic (RFC 6979 ECDSA). */
export async function signVoucher(
  scorerPrivateKey: Hex,
  voucher: Voucher,
  ctx: VoucherContext,
): Promise<SignedVoucher> {
  const account = privateKeyToAccount(scorerPrivateKey);
  const signature = await account.signTypedData({
    domain: buildVoucherDomain(ctx.chainId, ctx.verifyingContract),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: voucher,
  });
  return { voucher, signature, signer: account.address };
}

/** Recover the address that produced a voucher signature (mirrors on-chain ecrecover). */
export function recoverVoucherSigner(
  voucher: Voucher,
  signature: Hex,
  ctx: VoucherContext,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: buildVoucherDomain(ctx.chainId, ctx.verifyingContract),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: voucher,
    signature,
  });
}
