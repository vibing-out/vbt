import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vbt/ui ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@vbt/ui"],
};

export default nextConfig;
