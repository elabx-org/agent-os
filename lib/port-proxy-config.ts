/**
 * Port proxy settings: environment first, then $AGENT_OS_HOME/proxy.json,
 * then the portProxy flag. Read on every request through a short cache, so
 * server.ts and the Next routes agree without a restart.
 *
 *   AGENTOS_PROXY=0                  proxy off (no DB read)
 *   AGENTOS_PROXY_DOMAIN=d           subdomain mode on <port>.d
 *   AGENTOS_PROXY_SANDBOX=0          path mode without the sandbox (unsafe)
 *   AGENTOS_PROXY_SUBDOMAIN_SANDBOX=1  sandbox port hosts too
 *   AGENTOS_PROXY_DENY_PORTS=a,b     more refused ports
 *   AGENTOS_PROXY_STRIP_COOKIES=x,y_*  more cookies never sent to apps
 *   AGENTOS_PUBLIC_URL=https://...   where helper links point
 */

import fs from "fs";
import os from "os";
import path from "path";
import { getFlag } from "./flags";
import { DEFAULT_STRIPPED_COOKIES } from "./port-proxy-headers";
import { normaliseBase, parsePortList } from "./port-proxy-target";

export interface ProxySettingsFile {
  proxyDomain?: string;
  publicUrl?: string;
}

export interface ProxyConfig {
  enabled: boolean;
  /** Path mode responses get the sandbox CSP */
  sandbox: boolean;
  /** Subdomain mode base, e.g. agent.example.com; null = off */
  subdomainBase: string | null;
  subdomainSandbox: boolean;
  ownPort: number;
  deny: number[];
  strippedCookies: string[];
}

const CACHE_MS = 5000;

const shared = globalThis as typeof globalThis & {
  __agentosProxySettings?: { value: ProxySettingsFile; at: number };
};

function home(): string {
  return process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
}

export function proxySettingsFile(): string {
  return path.join(home(), "proxy.json");
}

export function readProxySettings(): ProxySettingsFile {
  const cached = shared.__agentosProxySettings;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: ProxySettingsFile = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(proxySettingsFile(), "utf8"));
    if (parsed && typeof parsed === "object") value = parsed;
  } catch {
    // No file: environment only
  }
  shared.__agentosProxySettings = { value, at: Date.now() };
  return value;
}

export function proxyEnabled(): boolean {
  if (process.env.AGENTOS_PROXY === "0") return false;
  try {
    return getFlag("portProxy");
  } catch {
    return true;
  }
}

/** Subdomain mode's base domain, or null when it isn't configured */
export function proxyDomain(): string | null {
  const fromEnv = process.env.AGENTOS_PROXY_DOMAIN;
  return normaliseBase(
    fromEnv !== undefined ? fromEnv : readProxySettings().proxyDomain
  );
}

export function ownPort(): number {
  return parseInt(process.env.PORT || "3011", 10) || 3011;
}

export function proxyConfig(): ProxyConfig {
  const extraCookies = (process.env.AGENTOS_PROXY_STRIP_COOKIES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    enabled: proxyEnabled(),
    sandbox: process.env.AGENTOS_PROXY_SANDBOX !== "0",
    subdomainBase: proxyDomain(),
    subdomainSandbox: process.env.AGENTOS_PROXY_SUBDOMAIN_SANDBOX === "1",
    ownPort: ownPort(),
    deny: parsePortList(process.env.AGENTOS_PROXY_DENY_PORTS),
    strippedCookies: [...DEFAULT_STRIPPED_COOKIES, ...extraCookies],
  };
}

/** The configured public URL (no trailing slash), or null */
export function configuredPublicUrl(): string | null {
  const value =
    process.env.AGENTOS_PUBLIC_URL || readProxySettings().publicUrl || "";
  const clean = value.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/]+$/i.test(clean) ? clean : null;
}
