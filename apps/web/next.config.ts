import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vbt/ui, @vbt/domain and @vbt/events ship TypeScript source; Next compiles them with the app.
  // @vbt/crypto ships a built dist (the web scripts build it first).
  transpilePackages: ["@vbt/ui", "@vbt/domain", "@vbt/events"],
  // The public tracker is the product's front door.
  async redirects() {
    return [
      { source: "/", destination: "/track", permanent: false },
      // The receipt moved out of /track so the tracker sources hold no contact wording.
      { source: "/track/:code/receipt", destination: "/receipt/:code", permanent: false },
    ];
  },
};

export default nextConfig;
