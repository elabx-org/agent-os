/**
 * Which machine a tab is looking at, as pure decisions (no DOM): what to put
 * on a call, a socket's address, the cookie, the address to switch to. The
 * names match lib/link/server.ts, which is server-only.
 */

/** Sent on our own API calls (lib/link/server.ts MACHINE_HEADER) */
export const MACHINE_HEADER = "x-agentos-machine";
/** For what a page can't put a header on: images, links */
export const MACHINE_COOKIE = "agentos_machine";
/** On a socket's address */
export const MACHINE_QUERY = "machine";
/**
 * Not a machine id, so the server answers here; sent instead of nothing
 * when another tab's cookie names a machine and this tab is on the server.
 * The header (and a socket's query) wins over the cookie.
 */
export const HUB_TARGET = "hub";
/** The tab's machine, per tab (sessionStorage) */
export const MACHINE_STORAGE_KEY = "agentos.machine";
/** Set once this browser has looked at a machine: other tabs start guarding */
export const MACHINES_USED_KEY = "agentos.machines.used";

const MACHINE_ID = /^m_[0-9a-f]{12}$/;

export const isMachineId = (value: unknown): value is string =>
  typeof value === "string" && MACHINE_ID.test(value);

/** An API call or a socket on this server, not one already sent to /m/<id> */
export function isRoutedPath(url: URL, host: string): boolean {
  if (url.host !== host) return false;
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/");
}

/**
 * What the tab says about a call: its machine, "hub" when only another
 * tab's cookie names one (so this tab stays on the server), or nothing
 */
export function markerFor(
  tabMachine: string | null,
  cookieMachine: string | null
): string | null {
  if (isMachineId(tabMachine)) return tabMachine;
  return cookieMachine ? HUB_TARGET : null;
}

/** The header value for a call to `url`, or null to leave it untouched */
export function headerFor(
  url: URL,
  host: string,
  tabMachine: string | null,
  cookieMachine: string | null
): string | null {
  if (!isRoutedPath(url, host)) return null;
  return markerFor(tabMachine, cookieMachine);
}

/**
 * A socket's address with the marker on it, or null to leave it as it is
 * (not ours, nothing to say, or the caller already named a target)
 */
export function markedSocketUrl(
  raw: string,
  base: string,
  host: string,
  tabMachine: string | null,
  cookieMachine: string | null
): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  const marker = headerFor(url, host, tabMachine, cookieMachine);
  if (!marker || url.searchParams.has(MACHINE_QUERY)) return null;
  url.searchParams.set(MACHINE_QUERY, marker);
  return url.href;
}

/** A cookie's value from document.cookie */
export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

/** document.cookie's assignment that sets the marker, or clears it (null) */
export function cookieAssignment(machine: string | null): string {
  return machine && isMachineId(machine)
    ? `${MACHINE_COOKIE}=${machine}; Path=/; SameSite=Strict`
    : `${MACHINE_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
}

/** What to open once the tab is on the other machine */
export interface SwitchOpen {
  session?: string;
  project?: string;
}

/** The address a switch navigates to: home, or a session or project there */
export function switchHref(open: SwitchOpen = {}): string {
  if (open.session) return `/?session=${encodeURIComponent(open.session)}`;
  if (open.project) return `/?project=${encodeURIComponent(open.project)}`;
  return "/";
}

/** Errors the server gives when the tab's machine can't be reached */
const GONE_CODES = new Set([
  "machine_unknown",
  "machine_offline",
  "machine_unreachable",
]);

export function isMachineGone(status: number, body: unknown): boolean {
  if (status !== 404 && status !== 502 && status !== 503) return false;
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === "string" && GONE_CODES.has(code);
}

/**
 * The install command, short enough to read on a phone: the script's name
 * and the start of the invite ("curl -fsSL …/link-machine.sh | bash -s --
 * eyJodW…"); Copy takes the whole of it
 */
export function shortCommand(command: string): string {
  return command
    .replace(/https?:\/\/\S*\/([^/\s]+)/, "…/$1")
    .replace(/(-- )(\S{6})\S+$/, "$1$2…");
}

/** Whether the command's invite has a sign-in for the Mac to go through */
export function inviteHasSignIn(command: string): boolean | null {
  const invite = command.match(/-- (\S+)\s*$/)?.[1];
  if (!invite) return null;
  try {
    const base64 = invite.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("binary");
    const value = JSON.parse(json) as { signIn?: unknown };
    return !!value.signIn;
  } catch {
    return null;
  }
}
