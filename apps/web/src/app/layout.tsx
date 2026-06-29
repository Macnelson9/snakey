import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { RegisterSW } from "@/components/RegisterSW";
import { PrivyWalletProvider } from "@/components/PrivyWalletProvider";

export const metadata: Metadata = {
  title: "Buga",
  description: "The Nokia snake, now on Celo. Play instantly, earn G$.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PrivyWalletProvider>
          {children}
        </PrivyWalletProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
