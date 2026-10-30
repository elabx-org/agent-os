/**
 * What runs in the container (M16, the Running view): each listening port
 * the proxy can reach, the process behind it, and what in AgentOS started
 * it (a session's tmux pane, a project script's run, a dev server), found
 * by walking the process's parents.
 */

import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { listListeningPorts } from "@/lib/listening-ports";
import { proxyConfig } from "@/lib/port-proxy-config";
import { isRefusedPort } from "@/lib/port-proxy-target";
import { getDb, queries, type DevServer, type Session } from "@/lib/db";
import type { ScriptRun } from "@/lib/project-config-types";
import { stopScriptRun } from "@/lib/script-runs";
import { stopServer } from "@/lib/dev-servers";
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
  /** A project script's background run started it (Projects → Scripts) */
  script: { runId: string; scriptId: string } | null;
  /** One of the project's dev servers (Projects → Dev servers) */
  devServer: { id: string; name: string } | null;
  /** The project of whatever in AgentOS started it */
  projectId: string | null;
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

interface Owners {
  panes: Map<number, string>;
  scripts: Map<number, ScriptRun>;
  devServers: Map<number, DevServer>;
}

type Owner =
  | { tmux: string }
  | { script: ScriptRun }
  | { devServer: DevServer }
  | null;

/** What started a process: its nearest ancestor AgentOS knows */
function ownerOf(pid: number, owners: Owners): Owner {
  let at: number | null = pid;
  for (let hops = 0; at && at > 1 && hops < 64; hops++) {
    const pane = owners.panes.get(at);
    if (pane) return { tmux: pane };
    const script = owners.scripts.get(at);
    if (script) return { script };
    const devServer = owners.devServers.get(at);
    if (devServer) return { devServer };
    const stat = read(`/proc/${at}/stat`);
    at = stat ? parentOf(stat) : null;
  }
  return null;
}

/** Script runs and dev servers running now, by their own pid */
function agentosPids(): Pick<Owners, "scripts" | "devServers"> {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT * FROM script_runs WHERE status = 'running' AND pid IS NOT NULL`
    )
    .all() as ScriptRun[];
  const servers = (queries.getAllDevServers(db).all() as DevServer[]).filter(
    (s) => s.status === "running" && s.pid
  );
  return {
    scripts: new Map(runs.map((r) => [r.pid!, r])),
    devServers: new Map(servers.map((s) => [s.pid!, s])),
  };
}

export async function listRunning(): Promise<RunningServer[]> {
  const config = proxyConfig();
  const [ports, panes] = await Promise.all([listListeningPorts(), panePids()]);
  const sessions = queries.getAllSessions(getDb()).all() as Session[];
  const byTmux = new Map(sessions.map((s) => [s.tmux_name, s]));
  const owners: Owners = { panes, ...agentosPids() };
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
    const owner = pid ? ownerOf(pid, owners) : null;
    const tmux = owner && "tmux" in owner ? owner.tmux : null;
    const session = tmux ? (byTmux.get(tmux) ?? null) : null;
    const run = owner && "script" in owner ? owner.script : null;
    const dev = owner && "devServer" in owner ? owner.devServer : null;
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
      script: run ? { runId: run.id, scriptId: run.script_id } : null,
      devServer: dev ? { id: dev.id, name: dev.name } : null,
      projectId:
        session?.project_id ?? run?.project_id ?? dev?.project_id ?? null,
    });
  }
  // What AgentOS started first, newest first; the rest by port
  return out.sort(
    (a, b) =>
      Number(!stoppable(a)) - Number(!stoppable(b)) ||
      (stoppable(a) ? (b.startedAt ?? 0) - (a.startedAt ?? 0) : 0) ||
      a.port - b.port
  );
}

/** Started by a session, a script or a dev server: AgentOS may stop it */
export function stoppable(s: RunningServer): boolean {
  return !!(s.sessionId || s.script || s.devServer);
}

/**
 * Stops a server the list shows, by its pid, only one AgentOS started
 * that still listens on a port the list would show (not code-server or
 * anything else the container runs on its own): a script's run or a dev
 * server the way their own Stop does, a session's with SIGTERM. An agent
 * (`actor`, its tmux session) stops only what its own session started
 */
export async function stopRunning(
  pid: number,
  actor: string | null = null
): Promise<boolean> {
  const running = await listRunning();
  const server = running.find((r) => r.pid === pid && stoppable(r));
  if (!server) return false;
  if (actor !== null) {
    if (!server.sessionId || server.tmux !== actor) return false;
  } else if (server.script) {
    await stopScriptRun(server.script.runId);
    return true;
  } else if (server.devServer) {
    await stopServer(server.devServer.id);
    return true;
  }
  process.kill(pid, "SIGTERM");
  return true;
}
