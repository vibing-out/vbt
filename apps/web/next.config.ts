import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vbt/ui and @vbt/domain ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@vbt/ui", "@vbt/domain"],
  // The public tracker is the product's front door.
  async redirects() {
    return [{ source: "/", destination: "/track", permanent: false }];
  },
};

export default nextConfig;
