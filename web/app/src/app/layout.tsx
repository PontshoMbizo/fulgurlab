import type { Metadata } from "next";
import "./globals.css";

// Deliberately not using next/font/google (Geist): it fetches font files at
// build/dev time, and this sandbox's network doesn't reach
// fonts.googleapis.com -- next dev falls back silently, but next build was
// hanging/retrying on it. A system font stack has zero build-time network
// dependency and is a perfectly reasonable look for a tool UI.
export const metadata: Metadata = {
  title: "fulgurlab",
  description: "Unified circuit, FPGA, and MCU simulation lab",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
