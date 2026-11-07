import "server-only";

// Live pipeline numbers for /factory, from GitHub's public API. The repo is public, so these calls
// are unauthenticated: no token exists to leak. Each number is null when its call fails (rate limit,
// network), so the page shows "unavailable" for that number instead of erroring or showing 0.

const REPO = "vibing-out/vbt";
const API = "https://api.github.com";
const HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "vbt-factory-page" };
// The hackathon runs in Indianapolis, so "today" starts at local midnight there.
const TIME_ZONE = "America/Indiana/Indianapolis";

export interface FactoryStats {
  ticketsClosed: number | null;
  ticketsOpen: number | null;
  mergedToday: number | null;
  epicsMerged: number | null;
}

async function getJson(path: string): Promise<unknown> {
  try {
    const response = await fetch(`${API}${path}`, { headers: HEADERS });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}

async function searchCount(query: string): Promise<number | null> {
  const body = (await getJson(`/search/issues?per_page=1&q=${encodeURIComponent(`repo:${REPO} ${query}`)}`)) as {
    total_count?: unknown;
  } | null;
  return typeof body?.total_count === "number" ? body.total_count : null;
}

/** The UTC instant of midnight today in `timeZone`, as an ISO string GitHub search accepts. */
export function startOfLocalDay(now: Date, timeZone: string = TIME_ZONE): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const localAsUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const midnightUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!) - offsetMs;
  return new Date(midnightUtc).toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function epicsMergedIntoMain(): Promise<number | null> {
  const pulls = await getJson(`/repos/${REPO}/pulls?state=closed&base=main&per_page=100`);
  if (!Array.isArray(pulls)) return null;
  return pulls.filter((p: { merged_at?: unknown; head?: { ref?: unknown } }) => {
    return typeof p.merged_at === "string" && typeof p.head?.ref === "string" && p.head.ref.startsWith("epic/");
  }).length;
}

/** Tickets are issues without the `epic` label; pull requests "merged today" count every base branch. */
export async function factoryStats(now: Date = new Date()): Promise<FactoryStats> {
  const [ticketsClosed, ticketsOpen, mergedToday, epicsMerged] = await Promise.all([
    searchCount("is:issue is:closed -label:epic"),
    searchCount("is:issue is:open -label:epic"),
    searchCount(`is:pr is:merged merged:>=${startOfLocalDay(now)}`),
    epicsMergedIntoMain(),
  ]);
  return { ticketsClosed, ticketsOpen, mergedToday, epicsMerged };
}
