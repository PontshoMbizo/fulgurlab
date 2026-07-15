import type { Metadata } from "next";
import "./globals.css";

// Geist/Geist Mono via plain <link> tags (matching the reference mockup's
// own approach) rather than next/font/google: the <link> tags fetch fonts
// at RUNTIME in the browser, with zero build-time network dependency, which
// sidesteps the next-build hang this sandbox hit earlier when the font was
// wired through Next's bundler-integrated font loader. Falls back to system
// fonts (see globals.css) if the network request fails or is slow, same as
// the browser does for any <link>-based webfont.
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- deliberate: see comment above (next/font/google hung the build in this sandbox; this app is single-page anyway so "only loads for one page" doesn't apply) */}
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
