import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vbt/ui and @vbt/domain ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@vbt/ui", "@vbt/domain"],
};

export default nextConfig;
