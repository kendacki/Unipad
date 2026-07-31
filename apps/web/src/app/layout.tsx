import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { WalletProvider } from "@/lib/wallet";
import { ToastProvider } from "@/lib/toast";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "Unipad — Launch & mint NFTs on Unicity",
  description: "Create a drop, mint with UCT, and get your NFT. Simple, fair, on Unicity",
  applicationName: "Unipad",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <ToastProvider>
          <WalletProvider>
            <SiteHeader />
            <main>{children}</main>
          </WalletProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
