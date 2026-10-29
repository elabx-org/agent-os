/**
 * Installs scripts/agentos-browser.sh as $AGENT_OS_HOME/bin/agentos-browser
 * and gives sessions BROWSER + AGENTOS_URL, so sign-in links CLIs open
 * reach the user as a toast (see lib/browser-open.ts). The installed copy
 * outlives repo swaps on deploy. AGENTOS_BROWSER_HELPER=0 or the port
 * proxy off (flag / AGENTOS_PROXY=0) turns it off.
 *
 * A BROWSER the session already has (code-server's browser-helper with
 * CODE_SERVER_URL) is kept, unless AGENTOS_PUBLIC_URL (or publicUrl in
 * proxy.json) says Agent-OS is where the user is.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { configuredPublicUrl, proxyEnabled } from "./port-proxy-config";

function home(): string {
  return process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
}

export function browserHelperPath(): string {
  return path.join(home(), "bin", "agentos-browser");
}

/** Copies the helper when it changed; its path, or null when it can't */
export function ensureBrowserHelper(): string | null {
  if (process.env.AGENTOS_BROWSER_HELPER === "0") return null;
  const to = browserHelperPath();
  try {
    const text = fs.readFileSync(
      path.join(process.cwd(), "scripts", "agentos-browser.sh"),
      "utf8"
    );
    let current: string | null = null;
    try {
      current = fs.readFileSync(to, "utf8");
    } catch {
      // Not installed yet
    }
    if (current !== text) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const tmp = `${to}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, { mode: 0o755 });
      fs.renameSync(tmp, to);
    }
    return to;
  } catch (error) {
    console.error("Failed to install the browser helper:", error);
    return null;
  }
}

export interface SessionBrowserEnv {
  /** Always set: AGENTOS_URL */
  env: Record<string, string>;
  /** The helper for BROWSER, null when off */
  browser: string | null;
  /** Replace a BROWSER the session already has */
  force: boolean;
}

const OFF: SessionBrowserEnv = { env: {}, browser: null, force: false };

/** What a session gets: BROWSER and where Agent-OS listens */
export function sessionBrowserEnv(): SessionBrowserEnv {
  let enabled = false;
  try {
    enabled = proxyEnabled();
  } catch {
    enabled = false;
  }
  if (!enabled) return OFF;
  const helper = ensureBrowserHelper();
  if (!helper) return OFF;
  const port = parseInt(process.env.PORT || "3011", 10) || 3011;
  return {
    env: { AGENTOS_URL: `http://127.0.0.1:${port}` },
    browser: helper,
    force: !!configuredPublicUrl(),
  };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/**
 * Lines for the generated bash script: `export KEY='value'`, and BROWSER
 * only when the session has none (or ours), unless forced
 */
export function exportLines(setup: SessionBrowserEnv): string {
  const lines = Object.entries(setup.env).map(
    ([key, value]) => `export ${key}=${shellQuote(value)}\n`
  );
  if (setup.browser) {
    const helper = shellQuote(setup.browser);
    lines.push(
      setup.force
        ? `export BROWSER=${helper}\n`
        : `if [ -z "\${BROWSER:-}" ] || [ "$BROWSER" = ${helper} ]; then export BROWSER=${helper}; fi\n`
    );
  }
  return lines.join("");
}

/**
 * `-e KEY=value` arguments for tmux new-session; BROWSER only when the
 * server's environment (which the tmux session inherits) has none
 */
export function tmuxEnvArgs(
  setup: SessionBrowserEnv,
  existingBrowser: string | undefined
): string[] {
  const env = { ...setup.env };
  if (
    setup.browser &&
    (setup.force || !existingBrowser || existingBrowser === setup.browser)
  ) {
    env.BROWSER = setup.browser;
  }
  return Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);
}
