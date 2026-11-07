import type { ReactNode } from "react";

export const metadata = { title: "VBT", description: "Verifiable Ballot Tracking" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
