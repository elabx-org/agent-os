import fs from "node:fs";
import path from "node:path";

function real(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

const CELLAR = /^(.+)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/;

/**
 * The Node to name in a command that is kept: a session's hooks, status
 * line and MCP server, which Claude Code reads once and runs for as long
 * as the session lives.
 *
 * process.execPath is the real file. On a Mac that is inside Homebrew's
 * Cellar, under the version (/opt/homebrew/Cellar/node@22/22.23.5_1/bin/
 * node): the next `brew upgrade` removes it, and every hook of every
 * running session then fails with "No such file or directory". The same
 * Node as Homebrew links it (/opt/homebrew/opt/node@22/bin/node) stays
 * where it is.
 */
export function stableNodePath(execPath: string = process.execPath): string {
  // Homebrew's own link to the formula, also once this version is gone
  const cellar = CELLAR.exec(execPath);
  if (cellar) {
    const linked = path.join(cellar[1], "opt", cellar[2], "bin", "node");
    if (real(linked)) return linked;
  }
  return real(execPath) ? execPath : "node";
}
