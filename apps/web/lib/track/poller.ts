// Live updates for the tracker page: poll GET /api/track/{code} (Austin's decision on #18; no Supabase
// Realtime). A pure scheduler: the clock, the request and the page visibility are injected.
//
// - Fetch at once, then start the next request POLL_INTERVAL_MS after the previous one *started*; if a
//   request runs longer, the next starts as soon as it finishes. Requests never overlap.
// - Each request is aborted after REQUEST_TIMEOUT_MS.
// - Stop for good once the ballot reaches a terminal status (isTerminal: CERTIFIED, DISCARDED, SPOILED).
// - Errors (network, timeout, 5xx, bad body, or a 404 after data was shown) back off 2 → 4 → 8 → 16 → 30 s
//   (cap); a success resets to 2 s. A 429 waits Retry-After seconds.
// - A 404 on the first load means an unknown code: report it and stop.
// - Hidden tab (Page Visibility API): clear the timer and abort the request. Visible again: fetch at once.
import { isTrackResult, type TrackResult } from "./types";

export const POLL_INTERVAL_MS = 2000;
export const MAX_BACKOFF_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_AFTER_S = 30;
const MAX_RETRY_AFTER_S = 300;

export interface Visibility {
  isHidden(): boolean;
  /** Calls back on every visibility change; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

export interface PollerCallbacks {
  onData(data: TrackResult): void;
  onNotFound(): void;
  /** A refresh failed or was rate-limited; another attempt is scheduled in `delayMs`. */
  onRetrying(delayMs: number): void;
}

export interface PollerDeps extends PollerCallbacks {
  request(signal: AbortSignal): Promise<Response>;
  visibility: Visibility;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface Poller {
  start(): void;
  stop(): void;
}

/** Backoff after `failures` consecutive errors (1 → 2 s, 2 → 4 s, ... capped at 30 s). */
export function backoffDelay(failures: number): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);
}

/** Retry-After in seconds → ms; anything unparsable gets the default. */
export function retryAfterMs(header: string | null): number {
  const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : DEFAULT_RETRY_AFTER_S;
  return Math.min(Math.max(seconds, 1), MAX_RETRY_AFTER_S) * 1000;
}

export function createPoller(deps: PollerDeps): Poller {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));

  let started = false;
  let stopped = false;
  let timer: unknown = null;
  let inflight: AbortController | null = null;
  let failures = 0;
  let hasData = false;
  let unsubscribe: (() => void) | null = null;

  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const later = (ms: number) => {
    clearTimer();
    if (ms <= 0) {
      void tick(); // a slow request already used up the interval: start the next one now
      return;
    }
    timer = schedule(() => {
      timer = null;
      void tick();
    }, ms);
  };

  const fail = () => {
    failures += 1;
    const delay = backoffDelay(failures);
    deps.onRetrying(delay);
    later(delay);
  };

  async function tick(): Promise<void> {
    if (stopped || inflight || deps.visibility.isHidden()) return;
    const controller = new AbortController();
    inflight = controller;
    const requestStarted = now();
    const timeout = schedule(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response | null = null;
    let body: unknown = undefined;
    try {
      response = await deps.request(controller.signal);
      if (response.status === 200) body = await response.json();
    } catch {
      response = null;
    } finally {
      cancel(timeout);
    }
    // Paused (hidden tab) or stopped while the request ran: drop the result.
    if (inflight !== controller) return;
    inflight = null;
    if (stopped) return;

    if (response?.status === 200 && isTrackResult(body)) {
      failures = 0;
      hasData = true;
      deps.onData(body);
      if (body.terminal) return stop();
      later(POLL_INTERVAL_MS - (now() - requestStarted));
    } else if (response?.status === 404 && !hasData) {
      deps.onNotFound();
      stop();
    } else if (response?.status === 429) {
      const delay = retryAfterMs(response.headers.get("Retry-After"));
      deps.onRetrying(delay);
      later(delay);
    } else {
      fail();
    }
  }

  const onVisibilityChange = () => {
    if (stopped || !started) return;
    if (deps.visibility.isHidden()) {
      clearTimer();
      inflight?.abort();
      inflight = null;
    } else if (!inflight) {
      clearTimer();
      void tick();
    }
  };

  function stop() {
    stopped = true;
    clearTimer();
    inflight?.abort();
    inflight = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      unsubscribe = deps.visibility.subscribe(onVisibilityChange);
      void tick();
    },
    stop,
  };
}

/** The browser's Page Visibility API as a Visibility. */
export function documentVisibility(doc: Document): Visibility {
  return {
    isHidden: () => doc.visibilityState === "hidden",
    subscribe(onChange) {
      doc.addEventListener("visibilitychange", onChange);
      return () => doc.removeEventListener("visibilitychange", onChange);
    },
  };
}
