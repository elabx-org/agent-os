/**
 * Installs scripts/agentos-browser.sh as $AGENT_OS_HOME/bin/agentos-browser
 * and gives sessions BROWSER + AGENTOS_URL, so sign-in links CLIs open
 * reach the user as a toast (see lib/browser-open.ts). The installed copy
 * outlives repo swaps on deploy. AGENTOS_BROWSER_HELPER=0 turns it off.
 */

import fs from "fs";
import os from "os";
import path from "path";

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

/** The environment a session gets: BROWSER and where Agent-OS listens */
export function sessionBrowserEnv(): Record<string, string> {
  const helper = ensureBrowserHelper();
  if (!helper) return {};
  const port = parseInt(process.env.PORT || "3011", 10) || 3011;
  return { BROWSER: helper, AGENTOS_URL: `http://127.0.0.1:${port}` };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** `export KEY='value'` lines for a generated bash script */
export function exportLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}\n`)
    .join("");
}

/** `-e KEY=value` arguments for tmux new-session */
export function tmuxEnvArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);
}
