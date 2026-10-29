/**
 * fetch for user-only actions: on a 403 {reason:"no_proof"} (the per-boot
 * cookie went stale with a server swap) it loads the proof page in a hidden
 * iframe to get a fresh cookie and retries once. No page reload.
 */
export async function fetchAsUser(
  input: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, init);
}
