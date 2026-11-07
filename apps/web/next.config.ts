import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vbt/ui, @vbt/domain and @vbt/events ship TypeScript source; Next compiles them with the app.
  // @vbt/crypto ships a built dist (the web scripts build it first).
  transpilePackages: ["@vbt/ui", "@vbt/domain", "@vbt/events"],
};

export default nextConfig;
