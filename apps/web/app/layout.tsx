import "@vbt/ui/globals.css";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

// Font variables feed the token stacks in @vbt/ui (--vbt-font-sans and --vbt-font-mono).
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata = { title: "VBT", description: "Verifiable Ballot Tracking" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
