/**
 * Proof that a request comes from the user's browser, not an agent: a
 * per-boot secret in an HttpOnly cookie that server.ts issues only on
 * same-origin page navigations. Agents run as the same Unix user, so this
 * raises the bar to deliberate header forgery; it isn't isolation.
 */

import { randomBytes, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { authConfig, currentSession } from "./auth";

export const USER_PROOF_COOKIE = "agentos_u";

/** Same-origin page the client loads in a hidden iframe to get a fresh cookie */
export const USER_PROOF_PATH = "/api/user-proof";

export type UserProofFailure =
  | "agent_origin"
  | "cross_site"
  | "no_proof"
  | "no_session";

export type UserProof = { ok: true } | { ok: false; reason: UserProofFailure };

// server.ts and the Next route bundles are separate module graphs in one
// process: the secret lives on globalThis so both see the same one
const globalForProof = globalThis as typeof globalThis & {
  __agentosUserSecret?: string;
};

/** The per-boot secret (random 32 bytes on globalThis, never on disk) */
export function userSecret(): string {
  globalForProof.__agentosUserSecret ??= randomBytes(32).toString("base64url");
  return globalForProof.__agentosUserSecret;
}

type HeaderValue = string | string[] | null | undefined;

/** A header's first value (proxies may append to a list) */
const first = (value: HeaderValue) =>
  (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim() || null;

function readCookie(header: HeaderValue, name: string): string | null {
  const raw = Array.isArray(header) ? header.join(";") : (header ?? "");
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function isSecret(value: string | null): boolean {
  if (!value) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(userSecret());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Origin is this site, as the browser sees it (directly or via the proxy) */
function originMatches(
  origin: string | null,
  host: string | null,
  forwardedHost: string | null
): boolean {
  if (!origin) return false;
  try {
    const { host: originHost } = new URL(origin);
    return originHost === first(host) || originHost === first(forwardedHost);
  } catch {
    return false;
  }
}

/** For route handlers (Web Request / NextRequest); fails closed */
export function requireUser(req: Request): UserProof {
  const headers = req.headers;
  if (headers.get("x-agentos-origin")?.toLowerCase() === "agent") {
    return { ok: false, reason: "agent_origin" };
  }
  if (
    headers.get("sec-fetch-site") !== "same-origin" ||
    !originMatches(
      headers.get("origin"),
      headers.get("host"),
      headers.get("x-forwarded-host")
    )
  ) {
    return { ok: false, reason: "cross_site" };
  }
  const cookies = headers.get("cookie");
  if (!isSecret(readCookie(cookies, USER_PROOF_COOKIE))) {
    return { ok: false, reason: "no_proof" };
  }
  // currentSession takes Node's request but only reads its cookie header
  if (
    authConfig() &&
    !currentSession({ headers: { cookie: cookies ?? "" } } as IncomingMessage)
  ) {
    return { ok: false, reason: "no_session" };
  }
  return { ok: true };
}

/** A page or iframe the user's browser opened on this site, not a fetch */
function isUserNavigation(req: IncomingMessage): boolean {
  const h = req.headers;
  const site = first(h["sec-fetch-site"]);
  const dest = first(h["sec-fetch-dest"]);
  return (
    req.method === "GET" &&
    first(h["x-agentos-origin"])?.toLowerCase() !== "agent" &&
    first(h["sec-fetch-mode"]) === "navigate" &&
    (dest === "document" || dest === "iframe") &&
    (site === "same-origin" || site === "none")
  );
}

/** server.ts: sets the cookie on same-origin document/iframe navigations */
export function issueUserProof(
  req: IncomingMessage,
  res: ServerResponse
): void {
  if (!isUserNavigation(req)) return;
  if (isSecret(readCookie(req.headers.cookie, USER_PROOF_COOKIE))) return;
  const https =
    first(req.headers["x-forwarded-proto"]) === "https" ||
    !!(req.socket as { encrypted?: boolean } | undefined)?.encrypted;
  // No Max-Age: the secret only lives as long as this server process
  const cookie = `${USER_PROOF_COOKIE}=${userSecret()}; Path=/; HttpOnly; SameSite=Strict${https ? "; Secure" : ""}`;
  const existing = res.getHeader("Set-Cookie");
  res.setHeader(
    "Set-Cookie",
    existing === undefined
      ? cookie
      : [...(Array.isArray(existing) ? existing : [String(existing)]), cookie]
  );
}
