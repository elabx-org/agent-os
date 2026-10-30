/**
 * Where the user opens AgentOS (https://agent.example.com), for links
 * agents share: the configured public URL, else the last origin the
 * user's own browser came from (remembered on disk, so it outlives a
 * restart), else none, and agents fall back to a relative /proxy/<port>/.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { configuredPublicUrl } from "./port-proxy-config";
import { hasUserCookie } from "./user-proof";
import { isLoopbackHostname } from "./proxy-url";

const shared = globalThis as typeof globalThis & {
  __agentosPublicOrigin?: string | null;
};

function originFile(): string {
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "public-origin");
}

const first = (value: string | null) => value?.split(",")[0].trim() || null;

/** The origin a request came to, as the browser saw it; null if loopback */
export function requestOrigin(req: Request): string | null {
  const host =
    first(req.headers.get("x-forwarded-host")) ??
    first(req.headers.get("host"));
  if (!host) return null;
  const proto =
    first(req.headers.get("x-forwarded-proto")) ??
    new URL(req.url).protocol.replace(/:$/, "");
  if (proto !== "http" && proto !== "https") return null;
  try {
    const url = new URL(`${proto}://${host}`);
    return isLoopbackHostname(url.hostname) ? null : url.origin;
  } catch {
    return null;
  }
}

/**
 * Remembers where the user is, from a request their browser made (the
 * proof cookie: an agent can't plant an origin for links)
 */
export function rememberPublicOrigin(req: Request): void {
  if (!hasUserCookie(req)) return;
  const origin = requestOrigin(req);
  if (!origin || origin === publicOrigin()) return;
  shared.__agentosPublicOrigin = origin;
  try {
    fs.writeFileSync(originFile(), origin + "\n", { mode: 0o600 });
  } catch {
    // Remembered for this run only
  }
}

/** The configured URL, else the remembered one, else null */
export function publicOrigin(): string | null {
  const configured = configuredPublicUrl();
  if (configured) return configured;
  if (shared.__agentosPublicOrigin === undefined) {
    let saved: string | null = null;
    try {
      saved = fs.readFileSync(originFile(), "utf8").trim() || null;
    } catch {
      saved = null;
    }
    shared.__agentosPublicOrigin =
      saved && /^https?:\/\/[^/]+$/.test(saved) ? saved : null;
  }
  return shared.__agentosPublicOrigin;
}
