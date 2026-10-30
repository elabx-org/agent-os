/**
 * A deploy removes the old build's code files. A page loaded before it
 * then fails when it first needs one (opening a terminal, a lazy panel):
 * stuck on "Connecting..." or a blank error page. Reloading is the fix.
 */

const CHUNK_FAILURE =
  /Failed to load chunk|Loading (CSS )?chunk \S+ failed|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function isChunkFailure(reason: unknown): boolean {
  if (!reason) return false;
  const text =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === "string"
        ? reason
        : String((reason as { message?: unknown }).message ?? "");
  return CHUNK_FAILURE.test(text);
}

const RELOADED_AT = "agentos-chunk-reload";
/** One reload a minute at most: a file that is really gone mustn't loop */
const RELOAD_GAP_MS = 60_000;

export function reloadOnce(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (now - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(RELOADED_AT, String(now));
  } catch {
    // No storage: reload anyway, the page is broken
  }
  location.reload();
  return true;
}
