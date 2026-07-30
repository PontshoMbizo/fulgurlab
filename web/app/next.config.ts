import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @fulgurlab/engine is a workspace package with no build step (its "main"
  // points straight at TS source, see engine/package.json) -- Next needs to
  // be told to run its own compiler over it rather than treating it as
  // pre-built node_modules code.
  transpilePackages: ["@fulgurlab/engine"],

  // The simulator is entirely client-side: `next build` already prerenders "/"
  // as static content, so there is no server requirement to keep. Setting
  // NEXT_OUTPUT_EXPORT=1 emits a plain directory of files (web/app/out) that
  // any static host can serve -- which is what the GitHub Pages workflow uses.
  // Left opt-in rather than always-on so `next dev` and `next start` keep
  // working unchanged for local development.
  ...(process.env.NEXT_OUTPUT_EXPORT === "1"
    ? { output: "export" as const, images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
