// Vercel Deployment Protection answers a protected preview with a 302 to Vercel SSO, so e2e requests
// (demo-officials.spec.ts) would never reach the app. With Protection Bypass for Automation, the
// project's secret goes in the x-vercel-protection-bypass header. Sent only when the secret is set.
// https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
export function protectionBypassHeaders(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return secret ? { "x-vercel-protection-bypass": secret } : undefined;
}
