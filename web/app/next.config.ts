import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @fulgurlab/engine is a workspace package with no build step (its "main"
  // points straight at TS source, see engine/package.json) -- Next needs to
  // be told to run its own compiler over it rather than treating it as
  // pre-built node_modules code.
  transpilePackages: ["@fulgurlab/engine"],
};

export default nextConfig;
