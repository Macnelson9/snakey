"use client";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { createContext, useContext, type ReactNode } from "react";
import { celo } from "viem/chains";
import type { Address } from "viem";

interface WalletCtx {
  address: Address | null;
  login: () => void;
  ready: boolean;
}

const WalletContext = createContext<WalletCtx>({
  address: null,
  login: () => {},
  ready: false,
});

function Inner({ children }: { children: ReactNode }) {
  const { ready, login } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address = (embedded?.address as Address | undefined) ?? null;
  return (
    <WalletContext.Provider value={{ address, login, ready }}>
      {children}
    </WalletContext.Provider>
  );
}

export function PrivyWalletProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    // Dev fallback when NEXT_PUBLIC_PRIVY_APP_ID is not set: render without
    // Privy so the app works in practice mode locally without credentials.
    return <>{children}</>;
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: celo,
        supportedChains: [celo],
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "dark" },
      }}
    >
      <Inner>{children}</Inner>
    </PrivyProvider>
  );
}

/** Returns the player's Privy embedded wallet address (or null if not logged in). */
export function usePlayerWallet(): WalletCtx {
  return useContext(WalletContext);
}
