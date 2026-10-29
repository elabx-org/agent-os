/**
 * Hidden git snapshots of a working tree: a private index under
 * $(git rev-parse --git-path agent-os), `add -A`, `write-tree`,
 * `commit-tree`, `update-ref refs/agent-os/<sessionId>/t<N>-pre|post`.
 * Never touches HEAD, the user's index, stash or branches.
 *
 * The work is done by scripts/agentos-snapshot.mjs, the same code the
 * Claude hook runs, so both kinds of turn snapshot the same way.
 */

import { execFile } from "child_process";
import path from "path";

export type SnapshotPoint = "pre" | "post";

const DEFAULT_TIMEOUT_MS = 3000;

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "agentos-snapshot.mjs");
}

/** The ref written, or null for a non-git folder or on failure/timeout */
export async function snapshot(
  cwd: string,
  sessionId: string,
  turnNo: number,
  point: SnapshotPoint,
  options: { timeoutMs?: number } = {}
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [
    scriptPath(),
    "snap",
    cwd,
    sessionId,
    String(turnNo),
    point,
    String(timeoutMs),
  ];
  return new Promise((resolve) => {
    // The script keeps its own deadline; this one is the backstop
    execFile(
      process.execPath,
      args,
      { timeout: timeoutMs + 2000, killSignal: "SIGKILL" },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const { ref } = JSON.parse(String(stdout));
          resolve(typeof ref === "string" ? ref : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}
