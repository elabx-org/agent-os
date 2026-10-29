/**
 * Links that CLIs in sessions ask to open (through $BROWSER, the
 * agentos-browser helper), held in memory until the page picks them up by
 * long polling and shows them as a toast. An agent can call this too, so it
 * can at most raise a rate-limited toast that names the host and session.
 */

import { parseLoopbackUrl } from "./proxy-url";

export type BrowserOpenKind = "loopback" | "external";

export interface BrowserOpenEvent {
  seq: number;
  /** ms since epoch */
  at: number;
  url: string;
  kind: BrowserOpenKind;
  /** The URL's host, always shown to the user */
  host: string;
  /** loopback: where it points */
  port?: number;
  path?: string;
  /** external: a localhost redirect_uri the sign-in will come back to */
  callbackPort?: number;
  session?: string | null;
}

export const MAX_URL_LENGTH = 4096;
const RING_SIZE = 20;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const DEDUPE_MS = 10_000;
/** A newly opened tab doesn't get links older than this */
export const FRESH_MS = 120_000;

export interface BrowserOpenState {
  seq: number;
  events: BrowserOpenEvent[];
  recent: number[];
  waiters: Set<() => void>;
  learnedBase: string | null;
}

export function createState(): BrowserOpenState {
  return {
    seq: 0,
    events: [],
    recent: [],
    waiters: new Set(),
    learnedBase: null,
  };
}

// Next's route bundles may load this module more than once
const shared = globalThis as typeof globalThis & {
  __agentosBrowserOpen?: BrowserOpenState;
};

export function sharedState(): BrowserOpenState {
  shared.__agentosBrowserOpen ??= createState();
  return shared.__agentosBrowserOpen;
}

const CALLBACK_PARAMS = [
  "redirect_uri",
  "redirect_url",
  "callback",
  "callback_url",
];

export type Classified = Omit<BrowserOpenEvent, "seq" | "at" | "session">;

/** What a link is; null when it isn't an http(s) URL we'd show */
export function classifyUrl(value: unknown): Classified | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const loop = parseLoopbackUrl(url);
  if (loop) {
    return {
      url,
      kind: "loopback",
      host: parsed.host,
      port: loop.port,
      path: loop.path,
    };
  }
  let callbackPort: number | undefined;
  for (const name of CALLBACK_PARAMS) {
    const target = parsed.searchParams.get(name);
    const callback = target ? parseLoopbackUrl(target) : null;
    if (callback) {
      callbackPort = callback.port;
      break;
    }
  }
  return {
    url,
    kind: "external",
    host: parsed.host,
    ...(callbackPort ? { callbackPort } : {}),
  };
}

/** A tmux session name as given, or null; nothing that could be markup */
export function cleanSessionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, 100);
  return /^[\w.:@-]+$/.test(name) ? name : null;
}

export type RecordResult =
  | { ok: true; event: BrowserOpenEvent; duplicate: boolean }
  | { ok: false; reason: "invalid" | "rate_limited" };

/** Stores a link and wakes the waiting pages */
export function recordOpen(
  url: unknown,
  session: unknown,
  state: BrowserOpenState = sharedState(),
  now = Date.now()
): RecordResult {
  const classified = classifyUrl(url);
  if (!classified) return { ok: false, reason: "invalid" };

  const duplicate = state.events.find(
    (e) => e.url === classified.url && now - e.at < DEDUPE_MS
  );
  if (duplicate) return { ok: true, event: duplicate, duplicate: true };

  state.recent = state.recent.filter((t) => now - t < RATE_WINDOW_MS);
  if (state.recent.length >= RATE_LIMIT) {
    return { ok: false, reason: "rate_limited" };
  }
  state.recent.push(now);

  const event: BrowserOpenEvent = {
    ...classified,
    seq: ++state.seq,
    at: now,
    session: cleanSessionName(session),
  };
  state.events.push(event);
  if (state.events.length > RING_SIZE) {
    state.events.splice(0, state.events.length - RING_SIZE);
  }
  const waiters = [...state.waiters];
  state.waiters.clear();
  for (const wake of waiters) wake();
  return { ok: true, event, duplicate: false };
}

/** Events after a seq; a first call (after null) gets none, only the seq */
export function eventsAfter(
  after: number | null,
  state: BrowserOpenState = sharedState(),
  now = Date.now()
): BrowserOpenEvent[] {
  if (after === null) return [];
  return state.events.filter((e) => e.seq > after && now - e.at < FRESH_MS);
}

/** Resolves with new events, or empty after the timeout or on abort */
export function waitForEvents(
  after: number | null,
  timeoutMs: number,
  state: BrowserOpenState = sharedState(),
  signal?: AbortSignal
): Promise<{ events: BrowserOpenEvent[]; seq: number }> {
  const ready = eventsAfter(after, state);
  if (ready.length || after === null || signal?.aborted) {
    return Promise.resolve({ events: ready, seq: state.seq });
  }
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      state.waiters.delete(finish);
      signal?.removeEventListener("abort", finish);
      resolve({ events: eventsAfter(after, state), seq: state.seq });
    };
    timer = setTimeout(finish, timeoutMs);
    state.waiters.add(finish);
    signal?.addEventListener("abort", finish);
  });
}

/** Remembers where the user opens Agent-OS (not loopback), for helper links */
export function learnPublicBase(
  base: string | null,
  state: BrowserOpenState = sharedState()
): void {
  if (!base || !/^https?:\/\/[^/]+$/i.test(base)) return;
  try {
    const host = new URL(base).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      return;
    }
  } catch {
    return;
  }
  state.learnedBase = base;
}
