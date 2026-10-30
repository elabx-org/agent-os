/**
 * What runs in the container (M16, the Running view): each listening port
 * the proxy can reach, the process behind it, and the AgentOS session that
 * started it, found by walking the process's parents up to a tmux pane.
 */

import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { listListeningPorts } from "@/lib/listening-ports";
import { proxyConfig } from "@/lib/port-proxy-config";
import { isRefusedPort } from "@/lib/port-proxy-target";
import { getDb, queries, type Session } from "@/lib/db";
import { publicOrigin } from "@/lib/public-origin";
import { proxyUrlFor } from "@/lib/proxy-url";

const execFileAsync = promisify(execFile);

export interface RunningServer {
  port: number;
  pid: number | null;
  /** The process's name ("node", "python3") */
  name: string;
  /** Its command line, shortened */
  command: string;
  cwd: string | null;
  /** When the process started (ms), when the kernel says */
  startedAt: number | null;
  sessionId: string | null;
  sessionName: string | null;
  /** The tmux session it runs under, an agent's or not */
  tmux: string | null;
  /** Through the port proxy, from this origin */
  url: string;
  /** The same, from where the user opens AgentOS when that's known */
  link: string;
}

const MAX_COMMAND = 160;

/** Parent pid from /proc/<pid>/stat (the field after the command's ")") */
export function parentOf(stat: string): number | null {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
}

/** Start time in clock ticks since boot (field 22 of /proc/<pid>/stat) */
export function startTicks(stat: string): number | null {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(fields[19]);
  return Number.isFinite(ticks) ? ticks : null;
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function bootTime(): number | null {
  const m = /^btime (\d+)$/m.exec(read("/proc/stat") ?? "");
  return m ? Number(m[1]) * 1000 : null;
}

/** tmux pane pid -> session name, for every pane on the server */
async function panePids(): Promise<Map<number, string>> {
  const panes = new Map<number, string>();
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{pane_pid} #{session_name}",
    ]);
    for (const line of stdout.trim().split("\n")) {
      const [pid, name] = line.split(" ");
      if (pid && name) panes.set(Number(pid), name);
    }
  } catch {
    // No tmux server: nothing ran from a session
  }
  return panes;
}

/** The tmux session a process runs under: its nearest pane ancestor */
function paneOf(pid: number, panes: Map<number, string>): string | null {
  let at: number | null = pid;
  for (let hops = 0; at && at > 1 && hops < 64; hops++) {
    const pane = panes.get(at);
    if (pane) return pane;
    const stat = read(`/proc/${at}/stat`);
    at = stat ? parentOf(stat) : null;
  }
  return null;
}

export async function listRunning(): Promise<RunningServer[]> {
  const config = proxyConfig();
  const [ports, panes] = await Promise.all([listListeningPorts(), panePids()]);
  const sessions = queries.getAllSessions(getDb()).all() as Session[];
  const byTmux = new Map(sessions.map((s) => [s.tmux_name, s]));
  const boot = bootTime();
  const origin = publicOrigin();
  const out: RunningServer[] = [];
  for (const entry of ports) {
    // AgentOS itself, and what the proxy refuses, aren't for previewing
    if (entry.port === config.ownPort || isRefusedPort(entry.port, config))
      continue;
    const proc = entry.processes[0];
    const pid = proc?.pid ?? null;
    const stat = pid ? read(`/proc/${pid}/stat`) : null;
    const ticks = stat ? startTicks(stat) : null;
    const command = pid
      ? (read(`/proc/${pid}/cmdline`) ?? "")
          .split("\0")
          .filter(Boolean)
          .join(" ")
      : "";
    let cwd: string | null = null;
    try {
      cwd = pid ? fs.readlinkSync(`/proc/${pid}/cwd`) : null;
    } catch {
      cwd = null;
    }
    const tmux = pid ? paneOf(pid, panes) : null;
    const session = tmux ? (byTmux.get(tmux) ?? null) : null;
    out.push({
      port: entry.port,
      pid,
      name: proc?.name ?? "",
      command:
        command.length > MAX_COMMAND
          ? `${command.slice(0, MAX_COMMAND - 1)}…`
          : command,
      cwd,
      // Clock ticks are 100 a second on Linux
      startedAt: boot !== null && ticks !== null ? boot + ticks * 10 : null,
      sessionId: session?.id ?? null,
      sessionName: session?.name ?? null,
      url: `/proxy/${entry.port}/`,
      link: origin
        ? proxyUrlFor(entry.port, "/", {
            origin,
            subdomainBase: config.subdomainBase,
            enabled: config.enabled,
          })
        : `/proxy/${entry.port}/`,
      tmux,
    });
  }
  // What sessions started first, newest first; the rest by port
  return out.sort(
    (a, b) =>
      Number(!a.sessionId) - Number(!b.sessionId) ||
      (a.sessionId ? (b.startedAt ?? 0) - (a.startedAt ?? 0) : 0) ||
      a.port - b.port
  );
}

/**
 * Stops a server the list shows, by its pid: SIGTERM, only to a process
 * a session started that still listens on a port the list would show (not
 * code-server or anything else the container runs on its own). An agent
 * (`actor`, its tmux session) stops only what its own session started
 */
export async function stopRunning(
  pid: number,
  actor: string | null = null
): Promise<boolean> {
  const running = await listRunning();
  const server = running.find((r) => r.pid === pid && r.sessionId);
  if (!server || (actor !== null && server.tmux !== actor)) return false;
  process.kill(pid, "SIGTERM");
  return true;
}
