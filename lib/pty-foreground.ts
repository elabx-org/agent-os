// What a terminal's PTY runs in front. AgentOS types its tmux attach and
// agent launch lines only at the shell's own prompt: typed into tmux or a
// running agent, they arrive as the user's input (a prompt Claude answers).

const SHELLS = new Set(["bash", "zsh", "sh", "dash", "fish", "ksh", "ash"]);

/** The terminal's foreground process group, from /proc/<shell pid>/stat */
export function parseTpgid(stat: string): number | null {
  // The command name (field 2) is in parentheses and may hold spaces
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const tpgid = Number(fields[5]);
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null;
}

/** /proc/<pid>/cmdline as its arguments */
export function parseCmdline(cmdline: string): string[] {
  return cmdline.split("\0").filter(Boolean);
}

function programName(args: string[]): string {
  return (args[0] ?? "").split("/").pop()!.replace(/^-/, "");
}

/** Without /proc: node-pty's name for the foreground process */
export function isPlainShell(processName: string): boolean {
  return SHELLS.has(programName([processName]));
}

// tmux commands that put a client in this terminal (as `tmux` alone does)
const TMUX_CLIENT = new Set([
  "attach",
  "attach-session",
  "a",
  "at",
  "new",
  "new-session",
]);

/**
 * The keys that leave what runs in front for the shell, when it's one of
 * ours: a tmux client detaches (Ctrl+B d), `claude attach` (a background
 * agent shown here) quits. Anything else (the user's, or a quick
 * `tmux set-option` on its way) gets none.
 */
export function leaveKeys(args: string[]): string | null {
  const name = programName(args);
  if (name === "tmux") {
    const sub = args.slice(1).find((a) => !a.startsWith("-"));
    if (!sub || TMUX_CLIENT.has(sub)) return "\x02d";
    return null;
  }
  if (name === "tmux: client") return "\x02d";
  if (name === "claude" && args[1] === "attach") return "\x03";
  return null;
}
