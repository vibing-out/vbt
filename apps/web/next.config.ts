import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/ui ships TypeScript source (shadcn monorepo layout).
  transpilePackages: ["@vbt/ui"],
};

export default nextConfig;
