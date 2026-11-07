import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vbt/ui, @vbt/domain and @vbt/demo ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@vbt/ui", "@vbt/domain", "@vbt/demo"],
};

export default nextConfig;
