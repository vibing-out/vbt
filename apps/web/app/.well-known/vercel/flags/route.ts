import { getProviderData as getVercelProviderData } from "@flags-sdk/vercel";
import { createFlagsDiscoveryEndpoint, getProviderData as getDeclaredProviderData } from "flags/next";
import type { NextRequest } from "next/server";
import * as flags from "../../../../flags";

// GET /.well-known/vercel/flags: the Flags Discovery Endpoint Flags Explorer (Vercel Toolbar) reads to
// list this app's flags. `createFlagsDiscoveryEndpoint` returns 401 with no body unless the Authorization
// header is an access proof encrypted with FLAGS_SECRET, so flag definitions stay private.
const discovery = createFlagsDiscoveryEndpoint(async () => {
  try {
    // With the FLAGS SDK key this adds the Vercel project ID, so Flags Explorer links to the dashboard.
    return await getVercelProviderData(flags);
  } catch {
    // Without the SDK key (local build, CI) the Vercel client has no datafile and throws; the flags as
    // declared in code still list every key, description, default and option.
    return getDeclaredProviderData(flags);
  }
});

export async function GET(request: NextRequest): Promise<Response> {
  // verifyAccess throws when FLAGS_SECRET is unset; nobody can hold a valid proof then, so answer 401.
  if (!process.env.FLAGS_SECRET) return Response.json(null, { status: 401 });
  return discovery(request);
}
