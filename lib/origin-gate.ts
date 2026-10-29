/**
 * Refuses calls to Agent-OS's API and sockets that come from a proxied app.
 *
 * A path-mode app is sandboxed into an opaque origin, so its requests carry
 * "Origin: null" (or Sec-Fetch-Site: cross-site); a subdomain-mode app is a
 * sibling host (Sec-Fetch-Site: same-site, a foreign Origin). Agent-OS's own
 * pages never send either, and tools without a browser (curl, the MCP
 * server, the browser helper) send none of Origin, Sec-Fetch-*, Referer.
 *
 * AGENTOS_ORIGIN_GATE=0 turns it off (escape hatch for odd front ends).
 */

import type { IncomingMessage, ServerResponse } from "http";
import { proxyDomain } from "./port-proxy-config";
import { firstHeader, matchProxyHost } from "./port-proxy-target";

export type OriginGateResult =
  | "ok"
  | "opaque_origin"
  | "foreign_origin"
  | "cross_site"
  | "proxied_referer";

type Headers = Record<string, string | string[] | undefined>;

/** Paths the gate guards: the API, sockets and sign-out */
export function isGatedPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/ws/") ||
    pathname === "/auth/logout"
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Pure: why a request to a gated path must be refused, or "ok". Cross-site
 * navigations pass only for /auth/logout: Agent-OS never needs another
 * site (or a sandboxed popup) to open an /api or /ws URL as a page.
 */
export function originGate(
  headers: Headers,
  options: { subdomainBase?: string | null; pathname?: string } = {}
): OriginGateResult {
  const ownHosts = [
    firstHeader(headers["host"]),
    firstHeader(headers["x-forwarded-host"]),
  ]
    .filter((h): h is string => !!h)
    .map((h) => h.toLowerCase());

  const origin = firstHeader(headers["origin"]);
  if (origin !== null) {
    if (origin === "null") return "opaque_origin";
    const host = hostOf(origin);
    if (!host || !ownHosts.includes(host)) return "foreign_origin";
  }

  const site = firstHeader(headers["sec-fetch-site"]);
  const mode = firstHeader(headers["sec-fetch-mode"]);
  const navigationOk =
    mode === "navigate" && options.pathname === "/auth/logout";
  if ((site === "cross-site" || site === "same-site") && !navigationOk) {
    return "cross_site";
  }

  const referer = firstHeader(headers["referer"]);
  if (referer) {
    const path = pathOf(referer);
    if (path.startsWith("/proxy/") || path.startsWith("/absproxy/")) {
      return "proxied_referer";
    }
    if (
      options.subdomainBase &&
      matchProxyHost(hostOf(referer), options.subdomainBase) !== null
    ) {
      return "proxied_referer";
    }
  }
  return "ok";
}

export function originGateEnabled(): boolean {
  return process.env.AGENTOS_ORIGIN_GATE !== "0";
}

function pathnameOf(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}

function refusal(req: IncomingMessage): OriginGateResult {
  const pathname = pathnameOf(req);
  if (!originGateEnabled() || !isGatedPath(pathname)) return "ok";
  return originGate(req.headers, { subdomainBase: proxyDomain(), pathname });
}

/** server.ts: answers 403 and returns true when the request is refused */
export function applyOriginGate(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const result = refusal(req);
  if (result === "ok") return false;
  res.writeHead(403, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(
    JSON.stringify({
      error: "Refused: request came from a proxied app",
      reason: result,
    })
  );
  return true;
}

/** server.ts upgrade handler: Agent-OS's own sockets (/ws/terminal) */
export function originGateRefusesUpgrade(req: IncomingMessage): boolean {
  return refusal(req) !== "ok";
}
