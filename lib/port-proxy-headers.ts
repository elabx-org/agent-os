/**
 * Header rules for the port proxy, all pure: what the upstream app gets
 * (no Agent-OS or front-door credentials, Host/Origin it accepts,
 * X-Forwarded-*), and what the browser gets back (no headers that would
 * apply to Agent-OS's origin, cookies and redirects kept under the proxy
 * path, and the sandbox that keeps the app from acting as Agent-OS).
 */

import { firstHeader, type ProxyMode } from "./port-proxy-target";

export type HeaderMap = Record<string, string | string[]>;

/**
 * Path mode: the app runs on Agent-OS's origin, so its documents are
 * sandboxed into an opaque origin. Never allow-same-origin, top navigation
 * or popups that escape the sandbox.
 */
export const SANDBOX_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

/** Who the user is to Agent-OS or the front door: never sent to the app */
const IDENTITY_HEADERS = new Set([
  "authorization",
  "x-agentos-origin",
  "remote-user",
  "remote-groups",
  "remote-name",
  "remote-email",
  "x-forwarded-user",
  "x-forwarded-email",
  "x-forwarded-groups",
]);

/** Set by the proxy itself; the client's values are dropped */
const REPLACED_HEADERS = new Set([
  "host",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-prefix",
  "x-real-ip",
  "forwarded",
]);

/** Response headers that would bind Agent-OS's whole origin */
const ORIGIN_WIDE_RESPONSE = new Set([
  "strict-transport-security",
  "clear-site-data",
  "public-key-pins",
  "public-key-pins-report-only",
  "expect-ct",
  "alt-svc",
  "service-worker-allowed",
  "origin-agent-cluster",
]);

const WEBSOCKET_KEEP = new Set(["connection", "upgrade"]);

/** Cookie names the app never sees or sets: Agent-OS's and the front door's */
export const DEFAULT_STRIPPED_COOKIES = ["agentos_*", "authelia_session"];

/** "agentos_*" matches by prefix, anything else exactly */
export function cookieNameMatches(
  name: string,
  patterns: readonly string[]
): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*")
      ? name.startsWith(pattern.slice(0, -1))
      : name === pattern
  );
}

/** "a=1; agentos_u=x; b=2" without the stripped names; null when empty */
export function stripCookieHeader(
  header: string,
  patterns: readonly string[]
): string | null {
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const name = part.split("=")[0].trim();
      return !cookieNameMatches(name, patterns);
    });
  return kept.length ? kept.join("; ") : null;
}

/** Pairs of [lower-case name, value] from Node's rawHeaders */
export function headerPairs(rawHeaders: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    pairs.push([rawHeaders[i].toLowerCase(), rawHeaders[i + 1]]);
  }
  return pairs;
}

/** Names listed in Connection: these are hop-by-hop too */
function connectionTokens(pairs: [string, string][]): Set<string> {
  const tokens = new Set<string>();
  for (const [name, value] of pairs) {
    if (name !== "connection") continue;
    for (const token of value.split(",")) {
      const clean = token.trim().toLowerCase();
      if (clean) tokens.add(clean);
    }
  }
  return tokens;
}

function add(map: HeaderMap, name: string, value: string): void {
  const existing = map[name];
  if (existing === undefined) map[name] = value;
  else if (Array.isArray(existing)) existing.push(value);
  else map[name] = [existing, value];
}

export interface RequestContext {
  port: number;
  mode: ProxyMode;
  /** "/proxy/5173" in path modes, "" for a subdomain */
  prefix: string;
  /** Host as the browser sees it (X-Forwarded-Host, else Host) */
  publicHost: string;
  /** "http" or "https", as the browser sees it */
  proto: string;
  /** The TCP peer of this request */
  clientAddress: string;
  /** A WebSocket upgrade: Connection/Upgrade/Sec-WebSocket-* stay */
  upgrade?: boolean;
  /** Cookie name patterns stripped (DEFAULT_STRIPPED_COOKIES + config) */
  strippedCookies: readonly string[];
  /**
   * The request came from a page this proxy served for the same port
   * (fromProxiedPage): only then is "Origin: null" our sandbox, mapped to
   * the app's own origin, and Sec-Fetch-Site made same-origin
   */
  ownPage?: boolean;
}

/** The proxy prefix of a path ("/proxy/5173/x" -> port 5173), else null */
function proxiedPortOfPath(path: string): number | null {
  const match = /^\/(?:proxy|absproxy)\/(\d{1,5})(?:\/|$)/.exec(path);
  return match ? Number(match[1]) : null;
}

/**
 * Evidence that a request comes from a page the proxy served for this
 * port, on this host: its Referer is <public host>/(abs)proxy/<port>/...
 * (path modes) or the port host itself (subdomain mode). A sandboxed
 * page's Origin is "null" like any other sandboxed page on the web; the
 * Referer is what tells ours apart. Chrome sends it for navigations and
 * module scripts, not for fetch, XHR or WebSocket from a sandboxed page
 * (and a page with no-referrer sends none), so those fail the evidence
 * unless AGENTOS_PROXY_TRUST_NULL_ORIGIN=1.
 */
export function fromProxiedPage(
  headers: Record<string, string | string[] | undefined>,
  target: { port: number; mode: ProxyMode; publicHost: string }
): boolean {
  const referer = firstHeader(headers["referer"]);
  if (!referer || !target.publicHost) return false;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return false;
  }
  if (url.host.toLowerCase() !== target.publicHost.toLowerCase()) return false;
  if (target.mode === "subdomain") return true;
  return proxiedPortOfPath(url.pathname) === target.port;
}

/** The public host and scheme of a request, as the browser sees them */
export function publicHostOf(
  headers: Record<string, string | string[] | undefined>
): string {
  return (
    firstHeader(headers["x-forwarded-host"]) ??
    firstHeader(headers["host"]) ??
    ""
  );
}

/**
 * Origin or Referer pointing at the public host (or "null" from our own
 * sandboxed page, see fromProxiedPage) become the app's own localhost
 * origin, so dev servers' origin checks pass; anything else, including a
 * "null" from someone else's sandbox, is the browser's truth and goes as is.
 */
function rewriteOriginLike(
  value: string,
  ctx: RequestContext,
  keepPath: boolean
): string {
  const local = `http://localhost:${ctx.port}`;
  if (value === "null") return ctx.ownPage ? local : value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.host !== ctx.publicHost.toLowerCase()) return value;
  if (!keepPath) return local;
  let path = url.pathname;
  if (ctx.mode === "proxy" && ctx.prefix) {
    if (path === ctx.prefix) path = "/";
    else if (path.startsWith(`${ctx.prefix}/`)) {
      path = path.slice(ctx.prefix.length);
    }
  }
  return `${local}${path}${url.search}`;
}

/** Headers for the upstream request, from the browser's raw headers */
export function upstreamRequestHeaders(
  rawHeaders: readonly string[],
  ctx: RequestContext
): HeaderMap {
  const pairs = headerPairs(rawHeaders);
  const listed = connectionTokens(pairs);
  const out: HeaderMap = {};
  const forwardedFor: string[] = [];
  let forwardedProto: string | null = null;
  const cookies: string[] = [];

  for (const [name, value] of pairs) {
    if (name === "x-forwarded-for") {
      forwardedFor.push(value);
      continue;
    }
    if (name === "x-forwarded-proto") {
      forwardedProto ??= firstHeader(value);
      continue;
    }
    if (ctx.upgrade && WEBSOCKET_KEEP.has(name)) {
      add(out, name, value);
      continue;
    }
    if (HOP_BY_HOP.has(name) || IDENTITY_HEADERS.has(name)) continue;
    if (REPLACED_HEADERS.has(name)) continue;
    if (
      listed.has(name) &&
      !(ctx.upgrade && name.startsWith("sec-websocket"))
    ) {
      continue;
    }
    if (name === "cookie") {
      cookies.push(value);
      continue;
    }
    if (name === "origin") {
      add(out, name, rewriteOriginLike(value, ctx, false));
      continue;
    }
    if (name === "referer") {
      add(out, name, rewriteOriginLike(value, ctx, true));
      continue;
    }
    if (name === "sec-fetch-site" && ctx.ownPage) {
      // The sandbox makes every request of the app's page cross-site; to
      // the app it is its own page (Next blocks cross-site /_next/* loads)
      add(out, name, "same-origin");
      continue;
    }
    add(out, name, value);
  }

  const cookie = stripCookieHeader(cookies.join("; "), ctx.strippedCookies);
  if (cookie) out["cookie"] = cookie;

  out["host"] = `localhost:${ctx.port}`;
  out["x-forwarded-for"] = [...forwardedFor, ctx.clientAddress]
    .filter(Boolean)
    .join(", ");
  if (ctx.publicHost) out["x-forwarded-host"] = ctx.publicHost;
  out["x-forwarded-proto"] = forwardedProto ?? ctx.proto;
  if (ctx.mode !== "subdomain" && ctx.prefix) {
    out["x-forwarded-prefix"] = ctx.prefix;
  }
  if (ctx.clientAddress) out["x-real-ip"] = ctx.clientAddress;
  return out;
}

const LOOPBACK_URL =
  /^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{1,5})(\/[^?#]*)?(.*)$/i;

export interface ResponseContext {
  port: number;
  mode: ProxyMode;
  prefix: string;
  /** Subdomain mode: the base domain, e.g. agent.example.com */
  subdomainBase?: string | null;
  /** "http" or "https" as the browser sees it */
  proto: string;
  /** Add the sandbox CSP (path mode, unless turned off) */
  sandbox: boolean;
  /** The request's Origin header, for the opaque-origin CORS answer */
  requestOrigin?: string | null;
  /** The request came from our own proxied page (fromProxiedPage) */
  ownPage?: boolean;
  strippedCookies: readonly string[];
  /** A 101 answer: Connection/Upgrade/Sec-WebSocket-* stay */
  upgrade?: boolean;
}

/**
 * A redirect target as the browser must see it: loopback URLs (any port)
 * go through the proxy, root-relative paths stay under the prefix.
 */
export function rewriteLocation(value: string, ctx: ResponseContext): string {
  const loop = LOOPBACK_URL.exec(value.trim());
  if (loop) {
    const port = Number(loop[3]);
    if (!(port >= 1 && port <= 65535)) return value;
    const path = loop[4] || "/";
    const tail = loop[5] ?? "";
    if (ctx.mode === "subdomain") {
      return ctx.subdomainBase
        ? `${ctx.proto}://${port}.${ctx.subdomainBase}${path}${tail}`
        : value;
    }
    if (ctx.mode === "absproxy") {
      const prefix = `/absproxy/${port}`;
      return path === prefix || path.startsWith(`${prefix}/`)
        ? `${path}${tail}`
        : `${prefix}${path}${tail}`;
    }
    return `/proxy/${port}${path}${tail}`;
  }
  // Root-relative, not protocol-relative ("//host") or "/\host"; an app
  // that honours X-Forwarded-Prefix already put the prefix in
  if (ctx.mode === "proxy" && /^\/(?![/\\])/.test(value)) {
    const path = value.split(/[?#]/)[0];
    if (path === ctx.prefix || path.startsWith(`${ctx.prefix}/`)) return value;
    return `${ctx.prefix}${value}`;
  }
  return value;
}

/** Refresh: "5; url=/next" */
function rewriteRefresh(value: string, ctx: ResponseContext): string {
  const match = /^(\s*\d+\s*[;,]\s*url\s*=\s*)(['"]?)(.*?)\2\s*$/i.exec(value);
  if (!match) return value;
  return `${match[1]}${match[2]}${rewriteLocation(match[3], ctx)}${match[2]}`;
}

/** Per response: more (or bigger) Set-Cookies are dropped */
export const MAX_SET_COOKIES = 32;
export const MAX_SET_COOKIE_BYTES = 4096;

/**
 * The app's Set-Cookie as the browser may keep it: never Agent-OS's or the
 * front door's names (or __Host-/__Secure- ones), never a Domain (it would
 * reach Agent-OS or its siblings), and in path modes always under the
 * prefix, so an app can't fill Agent-OS's own paths with cookies (a cookie
 * bomb makes every Agent-OS request 431). Null drops it.
 */
export function rewriteSetCookie(
  value: string,
  ctx: ResponseContext
): string | null {
  const parts = value.split(";");
  const name = parts[0].split("=")[0].trim();
  if (!name) return null;
  if (value.length > MAX_SET_COOKIE_BYTES) return null;
  if (cookieNameMatches(name, ctx.strippedCookies)) return null;
  if (/^__(host|secure)-/i.test(name)) return null;

  const attributes: string[] = [];
  let path: string | null = null;
  for (const raw of parts.slice(1)) {
    const attr = raw.trim();
    if (!attr) continue;
    const key = attr.split("=")[0].trim().toLowerCase();
    if (key === "domain") continue;
    if (key === "path") {
      path = attr.slice(attr.indexOf("=") + 1).trim() || "/";
      continue;
    }
    attributes.push(attr);
  }
  if (ctx.mode === "proxy") {
    const original = path && path.startsWith("/") ? path : "/";
    path = original === "/" ? `${ctx.prefix}/` : `${ctx.prefix}${original}`;
  } else if (ctx.mode === "absproxy") {
    // The app is configured with the prefix as its base: its own paths
    // start with it. Anything else ("/", "/api") would land on Agent-OS
    const inside =
      !!path && (path === ctx.prefix || path.startsWith(`${ctx.prefix}/`));
    if (!inside) path = `${ctx.prefix}/`;
  }
  return [
    parts[0].trim(),
    ...(path ? [`Path=${path}`] : []),
    ...attributes,
  ].join("; ");
}

/** Headers for the browser, from the upstream response's raw headers */
export function downstreamResponseHeaders(
  rawHeaders: readonly string[],
  ctx: ResponseContext
): HeaderMap {
  const pairs = headerPairs(rawHeaders);
  const listed = connectionTokens(pairs);
  const out: HeaderMap = {};
  let cookieCount = 0;
  for (const [name, value] of pairs) {
    const keep =
      ctx.upgrade &&
      (WEBSOCKET_KEEP.has(name) ||
        name === "transfer-encoding" ||
        name.startsWith("sec-websocket"));
    if (!keep && (HOP_BY_HOP.has(name) || listed.has(name))) continue;
    if (ORIGIN_WIDE_RESPONSE.has(name)) continue;
    if (name === "set-cookie") {
      if (cookieCount >= MAX_SET_COOKIES) continue;
      const cookie = rewriteSetCookie(value, ctx);
      if (cookie) {
        add(out, name, cookie);
        cookieCount++;
      }
      continue;
    }
    if (name === "location" || name === "content-location") {
      add(out, name, rewriteLocation(value, ctx));
      continue;
    }
    if (name === "refresh") {
      add(out, name, rewriteRefresh(value, ctx));
      continue;
    }
    add(out, name, value);
  }

  if (ctx.sandbox) {
    // A second policy: browsers enforce both and sandbox flags intersect,
    // so the app's own CSP (and its own sandbox) still applies
    add(out, "content-security-policy", SANDBOX_CSP);
  }
  if (
    ctx.sandbox &&
    ctx.requestOrigin === "null" &&
    ctx.ownPage &&
    out["access-control-allow-origin"] === undefined
  ) {
    // Module scripts and fetches of our sandboxed page are CORS requests
    // from an opaque origin. Only for our own page (Referer under this
    // port's prefix): another site's sandboxed iframe gets no CORS answer
    out["access-control-allow-origin"] = "null";
    add(out, "vary", "Origin");
  }
  out["x-agentos-proxy"] = String(ctx.port);
  return out;
}

/**
 * The preflight answer for our own sandboxed page (opaque origin), given
 * by the proxy itself: the app sees the real request with its own origin,
 * so its CORS rules (if any) are for other origins, not for this page
 */
export function sandboxPreflightHeaders(
  requestMethod: string | null,
  requestHeaders: string | null
): HeaderMap {
  const out: HeaderMap = {
    "access-control-allow-origin": "null",
    "access-control-allow-methods": requestMethod || "GET",
    "access-control-max-age": "600",
    vary: "Origin",
    "content-length": "0",
  };
  if (requestHeaders) out["access-control-allow-headers"] = requestHeaders;
  return out;
}

/** A raw HTTP head: the first line, then the headers, then a blank line */
export function serializeHead(firstLine: string, headers: HeaderMap): string {
  const lines = [firstLine];
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n:]/.test(name)) continue;
    for (const one of Array.isArray(value) ? value : [value]) {
      if (/[\r\n]/.test(one)) continue;
      lines.push(`${name}: ${one}`);
    }
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/** Splits a raw response head into its status line and rawHeaders */
export function parseHead(
  head: string
): { statusLine: string; rawHeaders: string[] } | null {
  const lines = head.split("\r\n");
  const statusLine = lines.shift() ?? "";
  if (!/^HTTP\/1\.[01] \d{3}/.test(statusLine)) return null;
  const rawHeaders: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return null;
    rawHeaders.push(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return { statusLine, rawHeaders };
}
