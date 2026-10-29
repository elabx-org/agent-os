/**
 * The port proxy: an app listening on a port in the container is reachable
 * at /proxy/<port>/ (prefix stripped), /absproxy/<port>/ (path kept), or,
 * in subdomain mode, on the whole host <port>.<AGENTOS_PROXY_DOMAIN>. Like
 * code-server's, but path-mode responses are sandboxed so the app can't act
 * as Agent-OS (see docs/setup/port-proxy.md). Hand-written on node:http/net:
 * loopback only, bodies streamed, nothing decompressed or rewritten.
 */

import http, { type IncomingMessage, type ServerResponse } from "http";
import type { Socket } from "net";
import type { Duplex } from "stream";
import { authConfig, isAllowed } from "./auth";
import {
  proxyConfig,
  proxyDomain,
  type ProxyConfig,
} from "./port-proxy-config";
import {
  downstreamResponseHeaders,
  fromProxiedPage,
  parseHead,
  publicHostOf,
  sandboxPreflightHeaders,
  serializeHead,
  upstreamRequestHeaders,
  type RequestContext,
  type ResponseContext,
} from "./port-proxy-headers";
import { sendProxyProblem, type ProxyProblem } from "./port-proxy-pages";
import {
  connectLoopback,
  firstHeader,
  isRefusedPort,
  matchProxyHost,
  parseProxyPath,
  type ProxyMode,
} from "./port-proxy-target";

export type ProxyPhase = "host" | "path";

interface Target {
  port: number;
  mode: ProxyMode;
  prefix: string;
  upstreamPath: string;
  sandbox: boolean;
}

let warned = false;

function warnOnce(config: ProxyConfig): void {
  if (warned) return;
  warned = true;
  if (!config.sandbox) {
    console.warn(
      "> Port proxy: AGENTOS_PROXY_SANDBOX=0, proxied apps can control Agent-OS"
    );
  }
  let signIn = false;
  try {
    signIn = !!authConfig();
  } catch {
    // Reported by server.ts at startup
  }
  if (
    config.subdomainBase &&
    !config.subdomainSandbox &&
    config.subdomainBase.split(".").length > 2
  ) {
    console.warn(
      `> Port proxy: port hosts *.${config.subdomainBase} are same-site with other hosts under ${config.subdomainBase.split(".").slice(1).join(".")} (their cookies, CSRF). Prefer a separate domain or AGENTOS_PROXY_SUBDOMAIN_SANDBOX=1 (docs/setup/port-proxy.md).`
    );
  }
  if (config.subdomainBase && signIn) {
    console.warn(
      `> Port proxy: Agent-OS sign-in doesn't reach *.${config.subdomainBase}; port hosts answer 401 unless reached from loopback. Gate them in the front door instead.`
    );
  }
}

function isHttps(req: IncomingMessage): boolean {
  return !!(req.socket as { encrypted?: boolean }).encrypted;
}

/** "http" or "https", as the browser sees it */
function publicProto(req: IncomingMessage): string {
  const forwarded = firstHeader(req.headers["x-forwarded-proto"]);
  if (forwarded === "http" || forwarded === "https") return forwarded;
  return isHttps(req) ? "https" : "http";
}

/**
 * The request is from a page the proxy served for this port: Referer
 * evidence, or (opt-in) any "Origin: null" in a sandboxed mode
 */
function isOwnPage(
  req: IncomingMessage,
  target: Target,
  config: ProxyConfig,
  publicHost: string
): boolean {
  if (
    fromProxiedPage(req.headers, {
      port: target.port,
      mode: target.mode,
      publicHost,
    })
  ) {
    return true;
  }
  return (
    config.trustNullOrigin &&
    target.sandbox &&
    firstHeader(req.headers.origin) === "null"
  );
}

function contexts(
  req: IncomingMessage,
  target: Target,
  config: ProxyConfig,
  upgrade: boolean
): { request: RequestContext; response: ResponseContext } {
  const proto = publicProto(req);
  const publicHost = publicHostOf(req.headers);
  const ownPage = isOwnPage(req, target, config, publicHost);
  return {
    request: {
      port: target.port,
      mode: target.mode,
      prefix: target.prefix,
      publicHost,
      proto,
      clientAddress: req.socket.remoteAddress ?? "",
      upgrade,
      strippedCookies: config.strippedCookies,
      ownPage,
    },
    response: {
      port: target.port,
      mode: target.mode,
      prefix: target.prefix,
      subdomainBase: config.subdomainBase,
      proto,
      sandbox: target.sandbox,
      requestOrigin: firstHeader(req.headers.origin),
      ownPage,
      strippedCookies: config.strippedCookies,
      upgrade,
    },
  };
}

/** Finds the target for a request; a ProxyProblem when it must be refused */
function resolveTarget(
  req: IncomingMessage,
  phase: ProxyPhase,
  config: () => ProxyConfig
): Target | ProxyProblem | { redirect: string } | null {
  if (phase === "host") {
    const base = proxyDomain();
    if (!base) return null;
    // Host only: X-Forwarded-Host is client-supplied unless a front door
    // overwrites it, and Traefik keeps Host by default
    const port = matchProxyHost(firstHeader(req.headers.host), base);
    if (port === null) return null;
    const c = config();
    if (!c.enabled) return { kind: "disabled" };
    // Port hosts have no public paths: "/" makes /auth/* and /_next/* gated too
    if (!isAllowed(req, "/")) return { kind: "sign_in", port };
    return {
      port,
      mode: "subdomain",
      prefix: "",
      upstreamPath: req.url || "/",
      sandbox: c.subdomainSandbox,
    };
  }
  const raw = req.url ?? "";
  if (!raw.startsWith("/proxy/") && !raw.startsWith("/absproxy/")) return null;
  const c = config();
  // Off: as if it didn't exist (Next answers 404)
  if (!c.enabled) return null;
  const parsed = parseProxyPath(raw);
  if (!parsed) return null;
  if (parsed.kind === "bad") return { kind: "bad_path" };
  if (parsed.kind === "redirect") return { redirect: parsed.location };
  return {
    port: parsed.port,
    mode: parsed.mode,
    prefix: parsed.prefix,
    upstreamPath: parsed.upstreamPath,
    sandbox: c.sandbox,
  };
}

const isProblem = (value: object): value is ProxyProblem => "kind" in value;

/** Open proxied connections (requests + sockets) per port, and the cap */
const MAX_PER_PORT = 256;
const openPerPort = new Map<number, number>();

/** Counts a connection to the port; false (nothing counted) when full */
function takeSlot(port: number): boolean {
  const open = openPerPort.get(port) ?? 0;
  if (open >= MAX_PER_PORT) return false;
  openPerPort.set(port, open + 1);
  return true;
}

function releaseSlot(port: number): void {
  const open = (openPerPort.get(port) ?? 1) - 1;
  if (open <= 0) openPerPort.delete(port);
  else openPerPort.set(port, open);
}

/**
 * server.ts request handler. "host" runs first (a port host is never
 * Agent-OS), "path" after sign-in. True when the request was answered.
 */
export async function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  phase: ProxyPhase
): Promise<boolean> {
  let config: ProxyConfig | undefined;
  const getConfig = () => (config ??= proxyConfig());
  const target = resolveTarget(req, phase, getConfig);
  if (!target) return false;
  warnOnce(getConfig());
  if ("redirect" in target) {
    res.writeHead(308, {
      Location: target.redirect,
      "Cache-Control": "no-store",
    });
    res.end();
    return true;
  }
  if (isProblem(target)) {
    sendProxyProblem(req, res, target);
    return true;
  }
  if (isRefusedPort(target.port, getConfig())) {
    sendProxyProblem(req, res, { kind: "refused", port: target.port });
    return true;
  }
  if (!takeSlot(target.port)) {
    sendProxyProblem(req, res, { kind: "busy", port: target.port });
    return true;
  }
  res.once("close", () => releaseSlot(target.port));
  await forward(req, res, target, getConfig());
  return true;
}

async function forward(
  req: IncomingMessage,
  res: ServerResponse,
  target: Target,
  config: ProxyConfig
): Promise<void> {
  const ctx = contexts(req, target, config, false);
  if (
    target.sandbox &&
    req.method === "OPTIONS" &&
    ctx.response.requestOrigin === "null" &&
    ctx.response.ownPage &&
    !!req.headers["access-control-request-method"]
  ) {
    // Our sandboxed page's preflight is answered here: apps that answer
    // OPTIONS themselves (Express, Flask...) don't list our opaque origin
    req.resume();
    res.writeHead(
      204,
      sandboxPreflightHeaders(
        firstHeader(req.headers["access-control-request-method"]),
        (req.headers["access-control-request-headers"] as string) ?? null
      )
    );
    res.end();
    return;
  }

  let socket: Socket;
  try {
    socket = await connectLoopback(target.port);
  } catch (error) {
    const timeout = (error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    sendProxyProblem(req, res, {
      kind: timeout ? "timeout" : "not_listening",
      port: target.port,
    });
    return;
  }
  if (res.destroyed || req.destroyed) {
    socket.destroy();
    return;
  }

  const upstreamReq = http.request({
    method: req.method,
    path: target.upstreamPath,
    headers: upstreamRequestHeaders(req.rawHeaders, ctx.request),
    // No `agent` option: with agent:false Node ignores createConnection
    createConnection: () => socket,
  });

  upstreamReq.on("response", (upstreamRes) => {
    const status = upstreamRes.statusCode ?? 502;
    try {
      res.writeHead(
        status,
        upstreamRes.statusMessage,
        downstreamResponseHeaders(upstreamRes.rawHeaders, ctx.response)
      );
      res.flushHeaders();
    } catch (error) {
      console.error("Port proxy: bad upstream headers:", error);
      upstreamRes.destroy();
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad response from the app\n");
      } else {
        res.destroy();
      }
      return;
    }
    upstreamRes.pipe(res);
    upstreamRes.on("error", () => res.destroy());
    upstreamRes.on("aborted", () => res.destroy());
  });

  upstreamReq.on("error", () => {
    if (!res.headersSent) {
      sendProxyProblem(req, res, { kind: "not_listening", port: target.port });
    } else {
      res.destroy();
    }
  });

  // The browser went away: stop the upstream too (long polls, SSE)
  res.on("close", () => {
    if (!res.writableFinished) upstreamReq.destroy();
  });
  req.pipe(upstreamReq);
}

// --- WebSocket upgrades ---

function reject(socket: Duplex, status: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
  } catch {
    // Already gone
  }
  socket.destroy();
}

/**
 * Cross-site WebSocket hijacking: a browser page may only open a socket to
 * the app from this host, or as "null" from our own sandboxed page (its
 * Referer under this port's prefix: any site can make a "null" origin);
 * non-browsers send no Origin
 */
function upgradeOriginAllowed(
  req: IncomingMessage,
  target: Target,
  config: ProxyConfig
): boolean {
  const origin = firstHeader(req.headers.origin);
  if (origin === null) return true;
  if (origin === "null") {
    return isOwnPage(req, target, config, publicHostOf(req.headers));
  }
  try {
    return (
      new URL(origin).host.toLowerCase() ===
      publicHostOf(req.headers).toLowerCase()
    );
  } catch {
    return false;
  }
}

const MAX_HEAD = 64 * 1024;

/**
 * server.ts upgrade handler; synchronous true when the socket is the
 * proxy's (it then answers or pipes it asynchronously).
 */
export function proxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  phase: ProxyPhase
): boolean {
  let config: ProxyConfig | undefined;
  const getConfig = () => (config ??= proxyConfig());
  const target = resolveTarget(req, phase, getConfig);
  if (!target) return false;
  if ("redirect" in target) {
    reject(socket, "400 Bad Request");
    return true;
  }
  if (isProblem(target)) {
    reject(
      socket,
      target.kind === "sign_in"
        ? "401 Unauthorized"
        : target.kind === "disabled"
          ? "404 Not Found"
          : "400 Bad Request"
    );
    return true;
  }
  const pathname = (req.url ?? "/").split("?")[0];
  if (phase === "path" && !isAllowed(req, pathname)) {
    reject(socket, "401 Unauthorized");
    return true;
  }
  if (!upgradeOriginAllowed(req, target, getConfig())) {
    reject(socket, "403 Forbidden");
    return true;
  }
  if (isRefusedPort(target.port, getConfig())) {
    reject(socket, "403 Forbidden");
    return true;
  }
  if (!takeSlot(target.port)) {
    reject(socket, "503 Service Unavailable");
    return true;
  }
  socket.once("close", () => releaseSlot(target.port));
  void pipeUpgrade(req, socket, head, target, getConfig());
  return true;
}

async function pipeUpgrade(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  target: Target,
  config: ProxyConfig
): Promise<void> {
  client.on("error", () => client.destroy());
  let upstream: Socket;
  try {
    upstream = await connectLoopback(target.port);
  } catch {
    reject(client, "502 Bad Gateway");
    return;
  }
  if (client.destroyed) {
    upstream.destroy();
    return;
  }
  const ctx = contexts(req, target, config, true);
  upstream.setNoDelay(true);
  upstream.on("error", () => client.destroy());
  upstream.on("close", () => client.destroy());
  client.on("close", () => upstream.destroy());

  upstream.write(
    serializeHead(
      `${req.method ?? "GET"} ${target.upstreamPath} HTTP/1.1`,
      upstreamRequestHeaders(req.rawHeaders, ctx.request)
    )
  );
  if (head.length) upstream.write(head);
  client.pipe(upstream);

  // The answer's head is filtered (no Agent-OS cookies, HSTS...); the frames
  // after it flow untouched
  let buffered = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    const end = buffered.indexOf("\r\n\r\n");
    if (end === -1) {
      if (buffered.length > MAX_HEAD) client.destroy();
      return;
    }
    upstream.off("data", onData);
    const parsed = parseHead(buffered.subarray(0, end).toString("latin1"));
    if (!parsed) {
      client.destroy();
      return;
    }
    const headers = downstreamResponseHeaders(parsed.rawHeaders, ctx.response);
    client.write(serializeHead(parsed.statusLine, headers));
    const rest = buffered.subarray(end + 4);
    if (rest.length) client.write(rest);
    upstream.pipe(client);
  };
  upstream.on("data", onData);
}
