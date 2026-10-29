/**
 * fetch for user-only actions: on a 403 {reason:"no_proof"} (the per-boot
 * cookie went stale with a server swap) it loads the proof page in a hidden
 * iframe to get a fresh cookie and retries once. No page reload.
 */

// USER_PROOF_PATH in lib/user-proof.ts, which is server-only (crypto)
const USER_PROOF_PATH = "/api/user-proof";
const PROOF_TIMEOUT_MS = 5000;

let proving: Promise<void> | null = null;

/** Loads the proof page as an iframe navigation, so server.ts re-issues the cookie */
function reprove(): Promise<void> {
  proving ??= new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    const done = () => {
      clearTimeout(timer);
      frame.remove();
      proving = null;
      resolve();
    };
    const timer = setTimeout(done, PROOF_TIMEOUT_MS);
    frame.onload = done;
    frame.src = `${USER_PROOF_PATH}?t=${Date.now()}`;
    document.body.appendChild(frame);
  });
  return proving;
}

async function needsProof(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { reason?: string } | null;
  return body?.reason === "no_proof";
}

export async function fetchAsUser(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (typeof document === "undefined" || !(await needsProof(res))) return res;
  await reprove();
  // Still refused: the caller shows "Reload to confirm it's you"
  return fetch(input, init);
}

/** A route's error in words; user_only survived fetchAsUser's retry */
export function refusalText(body: { error?: string; reason?: string }): string {
  if (body.error !== "user_only") return body.error ?? "Something went wrong";
  return body.reason === "no_proof"
    ? "Reload to confirm it's you"
    : "Only you can do this, in AgentOS";
}
