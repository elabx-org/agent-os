/**
 * macOS has no /proc: what AgentOS reads there on Linux (a process's
 * parent, its terminal's foreground group, its command line, cwd and age)
 * comes from `ps` and `lsof` instead. Only called when process.platform is
 * "darwin"; Linux keeps reading /proc.
 */

import { execFile, execFileSync } from "child_process";

export const isDarwin = (): boolean => process.platform === "darwin";

export interface PsRow {
  pid: number;
  ppid: number;
  /** The controlling terminal's foreground process group (0: no terminal) */
  tpgid: number;
  /** Seconds since it started */
  elapsed: number | null;
  /** Its command line, arguments joined by spaces (as ps prints it) */
  args: string;
}

/** `ps` columns parsePs reads, in order; args last (it holds spaces) */
export const PS_COLUMNS = "pid=,ppid=,tpgid=,etime=,args=";

/** `ps -o etime`: [[dd-]hh:]mm:ss -> seconds */
export function parseEtime(text: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!m) return null;
  const [, days, hours, minutes, seconds] = m;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds)
  );
}

/** Rows of `ps -o pid=,ppid=,tpgid=,etime=,args=` */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s?(.*)$/.exec(line);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      tpgid: Number(m[3]),
      elapsed: parseEtime(m[4]),
      args: m[5].trim(),
    });
  }
  return rows;
}

/** A command line as ps prints it, split at spaces (quoting is lost) */
export function splitArgs(args: string): string[] {
  return args.split(/\s+/).filter(Boolean);
}

/** `lsof -a -p PID -d cwd -Fn`: the n line is the folder */
export function parseLsofCwd(text: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || null;
    else if (line.startsWith("n") && pid !== null && !cwds.has(pid)) {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
}

// C locale: ps and lsof print the same whatever the user's language; wide
// (-ww): ps cuts args to 80 columns when it has no terminal
const ENV = () => ({ ...process.env, LC_ALL: "C" });
const psArgs = (pids: number[]) => [
  "-ww",
  "-o",
  PS_COLUMNS,
  "-p",
  pids.join(","),
];

/** ps rows for these pids (the ones still running) */
export function psSync(pids: number[]): PsRow[] {
  if (!pids.length) return [];
  try {
    return parsePs(
      execFileSync("ps", psArgs(pids), {
        encoding: "utf8",
        env: ENV(),
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      })
    );
  } catch (error) {
    // ps exits 1 when a pid is gone, but still prints the rest
    const out = (error as { stdout?: string }).stdout;
    return typeof out === "string" ? parsePs(out) : [];
  }
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: "utf8", env: ENV(), timeout: 5000, maxBuffer: 16 << 20 },
      // ps and lsof exit 1 when some or all they were asked for is gone
      (_error, stdout) => resolve(typeof stdout === "string" ? stdout : "")
    );
  });
}

/** ps rows for these pids, or every process with none given */
export async function ps(pids?: number[]): Promise<PsRow[]> {
  if (pids && !pids.length) return [];
  return parsePs(
    await run("ps", pids ? psArgs(pids) : ["-A", "-ww", "-o", PS_COLUMNS])
  );
}

/** The working folders of these pids (this user's processes only) */
export async function cwds(pids: number[]): Promise<Map<number, string>> {
  if (!pids.length) return new Map();
  return parseLsofCwd(
    await run("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fn"])
  );
}

/** The terminal's foreground group leader, for a process on it */
export function foregroundGroupSync(pid: number): number | null {
  const row = psSync([pid])[0];
  return row && row.tpgid > 1 ? row.tpgid : null;
}

/** The same, without blocking */
export async function foregroundGroup(pid: number): Promise<number | null> {
  const row = (await ps([pid]))[0];
  return row && row.tpgid > 1 ? row.tpgid : null;
}

/**
 * What runs in front of a terminal whose shell is `shellPid` (server.ts):
 * the shell itself, or the foreground group's leader and its arguments.
 * Null when ps can't say.
 */
export function terminalForeground(
  shellPid: number
): { shell: boolean; args: string[]; pid: number } | null {
  const tpgid = foregroundGroupSync(shellPid);
  if (tpgid === null) return null;
  if (tpgid === shellPid) return { shell: true, args: [], pid: shellPid };
  const leader = psSync([tpgid])[0];
  if (!leader) return null;
  return { shell: false, args: splitArgs(leader.args), pid: tpgid };
}
