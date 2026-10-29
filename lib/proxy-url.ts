/**
 * Proxy URLs for apps running in the container, shared by the client (Open
 * links, the sign-in toast) and the server (the browser helper's answer).
 * No server imports.
 */

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "0.0.0.0",
]);

export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(name) || name.endsWith(".localhost");
}

export interface LoopbackTarget {
  port: number;
  /** Path + query + hash, always starting with "/" */
  path: string;
}

/** "http://localhost:1455/auth/callback?code=x" -> {port, path}; else null */
export function parseLoopbackUrl(value: string): LoopbackTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isLoopbackHostname(url.hostname)) return null;
  // An explicit port only: a bare "localhost" has nothing to proxy to
  if (!url.port) return null;
  const port = Number(url.port);
  if (!(port >= 1 && port <= 65535)) return null;
  return { port, path: `${url.pathname || "/"}${url.search}${url.hash}` };
}

export interface ProxyUrlOptions {
  /** Where Agent-OS is open, e.g. https://agent.example.com */
  origin: string;
  /** Subdomain mode's base domain, when configured */
  subdomainBase?: string | null;
  /** The proxy is on (else the plain localhost URL) */
  enabled?: boolean;
}

/** Agent-OS opened on this machine: localhost links work as they are */
export function isLocalOrigin(origin: string): boolean {
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * The URL that reaches localhost:<port><path> from where Agent-OS is open:
 * the port host in subdomain mode, else /proxy/<port>/, else (Agent-OS on
 * localhost, or the proxy off) the localhost URL itself.
 */
export function proxyUrlFor(
  port: number,
  path: string,
  options: ProxyUrlOptions
): string {
  const rest = path.startsWith("/") ? path : `/${path}`;
  const origin = options.origin.replace(/\/+$/, "");
  if (options.enabled === false || isLocalOrigin(origin)) {
    return `http://localhost:${port}${rest}`;
  }
  if (options.subdomainBase) {
    const protocol = origin.startsWith("https:") ? "https:" : "http:";
    return `${protocol}//${port}.${options.subdomainBase}${rest}`;
  }
  return `${origin}/proxy/${port}${rest}`;
}
