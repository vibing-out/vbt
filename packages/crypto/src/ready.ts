import sodiumModule from "libsodium-wrappers-sumo";

export type Sodium = typeof sodiumModule;

let readyPromise: Promise<void> | undefined;

/**
 * Initialise libsodium. Call once before any crypto operation; it is safe to
 * call repeatedly. Every async function in this package also awaits it, so
 * forgetting the call cannot produce a half-initialised result.
 */
export function ready(): Promise<void> {
  readyPromise ??= sodiumModule.ready;
  return readyPromise;
}

/** Internal: the initialised libsodium instance. */
export async function getSodium(): Promise<Sodium> {
  await ready();
  return sodiumModule;
}
