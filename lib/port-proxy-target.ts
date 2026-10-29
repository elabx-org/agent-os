/**
 * Where a proxied request goes: path parsing for /proxy/<port>/ and
 * /absproxy/<port>/, host matching for <port>.<base>, refused ports, and the
 * loopback-only connect. Everything but connectLoopback is pure.
 */

import net from "net";

export type ProxyMode = "proxy" | "absproxy" | "subdomain";

export type ProxyPath =
  | {
      kind: "ok";
      mode: "proxy" | "absproxy";
      port: number;
      /** What the upstream app sees: path + query */
      upstreamPath: string;
      /** The public prefix, "/proxy/5173" (stripped in proxy mode) */
      prefix: string;
    }
  | { kind: "redirect"; location: string }
  | { kind: "bad"; status: 400; reason: string };

const PROXY_PATH = /^\/(proxy|absproxy)\/([^/?#]*)(.*)$/;

/** A port number 1-65535 written as plain digits, else null */
export function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** True when a path segment decodes to ".." (also %2e%2e), or can't decode */
function hasDotDot(path: string): boolean {
  for (const segment of path.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    if (decoded === ".." || decoded.split(/[\\/]/).includes("..")) return true;
  }
  return false;
}

/**
 * Parses the raw request URL (not the decoded pathname, so percent-encoding
 * reaches the app byte for byte). Null when it isn't a proxy path.
 */
export function parseProxyPath(rawUrl: string): ProxyPath | null {
  const match = PROXY_PATH.exec(rawUrl);
  if (!match) return null;
  const [, mode, portText, rest] = match as unknown as [
    string,
    "proxy" | "absproxy",
    string,
    string,
  ];
  const port = parsePort(portText);
  if (port === null) return { kind: "bad", status: 400, reason: "bad_port" };
  const prefix = `/${mode}/${port}`;

  // "/proxy/5173" or "/proxy/5173?x": relative URLs need the trailing slash
  if (rest === "" || rest.startsWith("?")) {
    return { kind: "redirect", location: `${prefix}/${rest}` };
  }
  if (!rest.startsWith("/")) {
    return { kind: "bad", status: 400, reason: "bad_path" };
  }
  const queryAt = rest.indexOf("?");
  const pathPart = queryAt === -1 ? rest : rest.slice(0, queryAt);
  if (hasDotDot(pathPart)) {
    return { kind: "bad", status: 400, reason: "dot_segment" };
  }
  return {
    kind: "ok",
    mode,
    port,
    upstreamPath: mode === "proxy" ? rest : rawUrl,
    prefix,
  };
}

/** A header's first value, as proxies may append a list */
export function firstHeader(
  value: string | string[] | null | undefined
): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return one?.split(",")[0].trim() || null;
}

/** "Agent.Example.com:443" -> "agent.example.com" */
export function hostnameOf(host: string | null | undefined): string {
  if (!host) return "";
  const lower = host.trim().toLowerCase();
  if (lower.startsWith("[")) return lower.slice(0, lower.indexOf("]") + 1);
  return lower.replace(/:\d+$/, "");
}

/** Normalises a configured base domain: no scheme, no port, no dots around */
export function normaliseBase(base: string | null | undefined): string | null {
  const clean = (base ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\.+|\.+$/g, "");
  return clean || null;
}

/** The port of a "<port>.<base>" host, else null */
export function matchProxyHost(
  host: string | null | undefined,
  base: string | null | undefined
): number | null {
  const domain = normaliseBase(base);
  if (!domain) return null;
  const name = hostnameOf(host);
  if (!name.endsWith(`.${domain}`)) return null;
  const label = name.slice(0, -domain.length - 1);
  return parsePort(label);
}

export interface RefusalConfig {
  /** This server's own port */
  ownPort: number;
  /** Extra refused ports (AGENTOS_PROXY_DENY_PORTS) */
  deny: readonly number[];
}

/** The live Agent-OS port, refused even from a test instance */
export const LIVE_AGENTOS_PORT = 3011;

/** Ports the proxy never connects to: Agent-OS itself and the deny list */
export function isRefusedPort(port: number, config: RefusalConfig): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return true;
  return (
    port === config.ownPort ||
    port === LIVE_AGENTOS_PORT ||
    config.deny.includes(port)
  );
}

/** "3000, 8443,x" -> [3000, 8443] */
export function parsePortList(text: string | undefined): number[] {
  return (text ?? "")
    .split(",")
    .map((part) => parsePort(part.trim()))
    .filter((port): port is number => port !== null);
}

function connectOnce(
  host: string,
  port: number,
  timeoutMs: number
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" })
      );
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

const RETRY_ON_V6 = new Set(["ECONNREFUSED", "EADDRNOTAVAIL", "ENETUNREACH"]);

/**
 * A TCP connection to the port on loopback: 127.0.0.1, then ::1. Never any
 * other host; the port is the only input.
 */
export async function connectLoopback(
  port: number,
  timeoutMs = 10_000
): Promise<net.Socket> {
  try {
    return await connectOnce("127.0.0.1", port, timeoutMs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!RETRY_ON_V6.has(code)) throw error;
    try {
      return await connectOnce("::1", port, timeoutMs);
    } catch {
      throw error;
    }
  }
}
