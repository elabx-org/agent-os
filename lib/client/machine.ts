/**
 * The tab's machine (another AgentOS linked to this one, e.g. a Mac): kept
 * per tab in sessionStorage. While it's set, our API calls and sockets carry
 * it and the server sends them to that machine, so every screen works there
 * unchanged. Switching is a full navigation, never an in-place swap.
 *
 * Installed once, before the app's first call (components/Providers.tsx).
 * A browser that has never looked at a machine gets no wrapper at all.
 */

import {
  HUB_TARGET,
  MACHINE_COOKIE,
  MACHINE_HEADER,
  MACHINE_STORAGE_KEY,
  MACHINES_USED_KEY,
  MACHINE_QUERY,
  cookieAssignment,
  headerFor,
  isMachineGone,
  isMachineId,
  linkTarget,
  markedSocketUrl,
  readCookie,
  switchHref,
  type SwitchOpen,
} from "@/lib/machine-marker";

/** Sent on window when a call says the tab's machine is gone or offline */
export const MACHINE_GONE_EVENT = "agentos:machine-gone";

function storage(kind: "session" | "local"): Storage | null {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/** The machine this tab is on; null on this server */
export function tabMachine(): string | null {
  if (typeof window === "undefined") return null;
  const value = storage("session")?.getItem(MACHINE_STORAGE_KEY) ?? null;
  return isMachineId(value) ? value : null;
}

const cookieMachine = () => readCookie(document.cookie, MACHINE_COOKIE);

/**
 * The cookie follows the tab: images and links have no header. Cleared on
 * this server. Nothing at all when neither the tab nor a cookie names one.
 */
function syncCookie() {
  const mine = tabMachine();
  const cookie = cookieMachine();
  if (mine === cookie || (!mine && !cookie)) return;
  document.cookie = cookieAssignment(mine);
}

let wrapped = false;

function wrap() {
  if (wrapped) return;
  wrapped = true;
  const host = window.location.host;

  const originalFetch = window.fetch;
  const markedFetch: typeof fetch = (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let url: URL | null = null;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      // Not a URL fetch can take either: let it say so
    }
    const mine = tabMachine();
    const value = url && headerFor(url, host, mine, cookieMachine());
    if (!value) return originalFetch.call(window, input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    // A caller that names a target itself (hubFetch) keeps it
    if (!headers.has(MACHINE_HEADER)) headers.set(MACHINE_HEADER, value);
    const sent = originalFetch.call(window, input, { ...init, headers });
    if (!mine || headers.get(MACHINE_HEADER) !== mine) return sent;
    return sent.then((res) => {
      if (res.status === 404 || res.status === 502 || res.status === 503) {
        res
          .clone()
          .json()
          .then((body) => {
            if (isMachineGone(res.status, body))
              window.dispatchEvent(new Event(MACHINE_GONE_EVENT));
          })
          .catch(() => {});
      }
      return res;
    });
  };
  window.fetch = markedFetch;

  const OriginalWebSocket = window.WebSocket;
  class MarkedWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const raw = typeof url === "string" ? url : url.href;
      super(
        markedSocketUrl(
          raw,
          window.location.href,
          host,
          tabMachine(),
          cookieMachine()
        ) ?? url,
        protocols
      );
    }
  }
  window.WebSocket = MarkedWebSocket;
}

/**
 * "?machine=<id>" on the page's own address (a notification's link): the
 * tab starts on that machine
 */
function adoptLinkedMachine() {
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }
  // Taken off the address once the app is up (MachineGate): the router
  // would put it back if it went now
  const target = linkTarget(url.searchParams.get(MACHINE_QUERY));
  if (!target) return;
  if (target === HUB_TARGET) {
    storage("session")?.removeItem(MACHINE_STORAGE_KEY);
  } else {
    storage("session")?.setItem(MACHINE_STORAGE_KEY, target);
    storage("local")?.setItem(MACHINES_USED_KEY, "1");
  }
}

let installed = false;

/** Once, before the app's first call; does nothing on the server */
export function installMachineMarker() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  adoptLinkedMachine();
  syncCookie();
  // Another tab may have moved the cookie while this one was away
  window.addEventListener("focus", syncCookie);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncCookie();
  });
  const used = storage("local")?.getItem(MACHINES_USED_KEY);
  if (tabMachine() || cookieMachine() || used) {
    wrap();
    return;
  }
  // From the moment another tab looks at a machine, this one keeps its
  // calls on this server (the cookie that tab sets is shared)
  window.addEventListener("storage", (e) => {
    if (e.key === MACHINES_USED_KEY && e.newValue) wrap();
  });
}

/**
 * The tab onto a machine (null: this server) and the app reloaded there,
 * on a session or project when one is named
 */
export function switchMachine(machine: string | null, open?: SwitchOpen) {
  const session = storage("session");
  if (machine && isMachineId(machine)) {
    session?.setItem(MACHINE_STORAGE_KEY, machine);
    storage("local")?.setItem(MACHINES_USED_KEY, "1");
  } else {
    session?.removeItem(MACHINE_STORAGE_KEY);
  }
  document.cookie = cookieAssignment(machine);
  window.location.assign(switchHref(open));
}

/**
 * Where a session lives when it isn't on the tab's machine: another linked
 * machine's id, "hub", or null when nothing reachable has it. Only asked
 * for a link whose session wasn't found here.
 */
export async function findSessionElsewhere(
  sessionId: string
): Promise<string | null> {
  try {
    const res = await hubFetch("/api/machines");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      enabled?: boolean;
      machines?: { id: string; status: string; presence: string }[];
    };
    if (!data.enabled) return null;
    const mine = tabMachine();
    const targets = (data.machines ?? [])
      .filter(
        (m) =>
          m.status === "approved" && m.presence === "online" && m.id !== mine
      )
      .map((m) => m.id);
    if (mine) targets.unshift(HUB_TARGET);
    const found = await Promise.all(
      targets.map(async (target) => {
        try {
          const list = await fetchOn(target, "/api/sessions");
          if (!list.ok) return false;
          const body = (await list.json()) as { sessions?: { id: string }[] };
          return !!body.sessions?.some((s) => s.id === sessionId);
        } catch {
          return false;
        }
      })
    );
    const at = found.indexOf(true);
    return at < 0 ? null : targets[at];
  } catch {
    return null;
  }
}

/** The tab onto where a link points ("hub" or a machine), on its session */
export function followLink(target: string, sessionId: string) {
  switchMachine(target === HUB_TARGET ? null : target, { session: sessionId });
}

/** A call answered by this server, whichever machine the tab is on */
export function hubFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set(MACHINE_HEADER, HUB_TARGET);
  return fetch(path, { ...init, headers });
}

/** A call to a machine by id, or to this server ("hub") */
export function fetchOn(
  target: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return target === HUB_TARGET
    ? hubFetch(path, init)
    : fetch(`/m/${target}${path}`, init);
}
