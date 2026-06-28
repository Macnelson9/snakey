import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import type { Voucher } from "./voucher.ts";

export const GAME_REWARDS_ABI = [
  {
    name: "redeem",
    type: "function",
    inputs: [
      {
        name: "voucher",
        type: "tuple",
        components: [
          { name: "player",   type: "address" },
          { name: "runId",    type: "bytes32"  },
          { name: "amount",   type: "uint256"  },
          { name: "deadline", type: "uint256"  },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export interface Relayer {
  redeem(voucher: Voucher, signature: Hex, contractAddress: Address): Promise<Hex>;
}

export function createRelayer(privateKey: Hex, rpcUrl: string): Relayer {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: celo,
    transport: http(rpcUrl),
  });
  return {
    async redeem(voucher, signature, contractAddress) {
      return client.writeContract({
        address: contractAddress,
        abi: GAME_REWARDS_ABI,
        functionName: "redeem",
        args: [voucher, signature],
      });
    },
  };
}
