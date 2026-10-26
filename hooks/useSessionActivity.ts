import { useEffect, useMemo, useState } from "react";
import { useSnapshot } from "valtio";
import type { DevServer, Session } from "@/lib/db";
import type { GitFile } from "@/lib/git-status";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { PermissionPrompt } from "@/lib/permission-prompt";
import type { SessionStatus } from "@/components/views/types";
import {
  fromSessionStatus,
  STATE_WORD,
  type AgentState,
} from "@/lib/agent-state";
import { mobileNavStore } from "@/stores/mobileNav";
import { useGitStatus, usePRStatus } from "@/data/git/queries";
import { useDevServersQuery } from "@/data/dev-servers";
import { useSessionPrompt } from "@/data/prompts/queries";
import { useSubagents } from "./useSubagents";

export interface SessionActivity {
  state: AgentState;
  /** When the session entered this state, as seen by this client */
  since: number;
  now: { label: string; command?: string; startedAt?: number };
  /** The prompt it's waiting on: undefined while loading or not waiting */
  prompt?: PermissionPrompt | null;
  files: { count: number; list: GitFile[] };
  agents: { list: SubagentInfo[]; running: number };
  devServer?: DevServer;
  pr?: { number: number; url: string; status: string; title?: string };
}

// Claude Code's tool lines ("● Bash(npm run build)") and spinner
// ("✻ Compiling… (12s · esc to interrupt)")
const TOOL_LINE = /[●⏺]\s*([A-Z]\w*)(?:\((.*?)\)?)?\s*$/;
const SPINNER_LINE = /^\s*[·✢✳✶✻✽*]\s+([A-Z][\w-]*)…/;

const TOOL_VERB: Record<string, string> = {
  Bash: "Running",
  Read: "Reading",
  Edit: "Editing",
  MultiEdit: "Editing",
  Update: "Editing",
  Write: "Writing",
  Grep: "Searching",
  Glob: "Searching",
  Search: "Searching",
  WebFetch: "Fetching",
  WebSearch: "Searching the web",
  Task: "Starting an agent",
  Agent: "Starting an agent",
};

/** What the pane's last line says Claude is doing; null when it can't tell */
export function parseLastLine(
  line: string | undefined
): { label: string; command?: string } | null {
  if (!line) return null;
  const tool = TOOL_LINE.exec(line);
  if (tool) {
    const command = tool[2]?.trim();
    return {
      label: TOOL_VERB[tool[1]] ?? tool[1],
      command: command || undefined,
    };
  }
  const spinner = SPINNER_LINE.exec(line);
  if (spinner) return { label: spinner[1] };
  return null;
}

// Kept per session across mounts, so the strip and the rail agree on the
// clock and a command doesn't vanish when the next poll shows the footer
const tracked = new Map<
  string,
  {
    state: AgentState;
    since: number;
    doing?: { label: string; command?: string; startedAt: number };
  }
>();

function track(sessionId: string, state: AgentState, line: string | undefined) {
  let entry = tracked.get(sessionId);
  if (!entry || entry.state !== state) {
    entry = { state, since: Date.now() };
    tracked.set(sessionId, entry);
  }
  const parsed = state === "work" ? parseLastLine(line) : null;
  if (
    parsed &&
    (parsed.label !== entry.doing?.label ||
      parsed.command !== entry.doing?.command)
  ) {
    entry.doing = { ...parsed, startedAt: Date.now() };
  }
  return entry;
}

function sameDir(a: string, b: string): boolean {
  const trim = (p: string) => p.replace(/\/+$/, "");
  const x = trim(a);
  const y = trim(b);
  if (x === y) return true;
  // One side may still say ~ for the home directory
  if (x.startsWith("~")) return y.endsWith(x.slice(1));
  if (y.startsWith("~")) return x.endsWith(y.slice(1));
  return false;
}

/**
 * Everything the activity strip and rail show about one session: its state
 * and what it's doing, the prompt it waits on, changed files, subagents, its
 * dev server and pull request. Polls only while `active`; the PR lookup
 * (a GitHub call) only with `rail`.
 */
export function useSessionActivity(
  session: Session | undefined,
  { active = true, rail = false }: { active?: boolean; rail?: boolean } = {}
): SessionActivity {
  const id = session?.id ?? "";
  const dir = session?.working_directory ?? "";
  const { statuses } = useSnapshot(mobileNavStore);
  const status = statuses[id] as SessionStatus | undefined;
  const state = fromSessionStatus(status?.status ?? "idle");
  const on = active && !!session;

  const { data: prompt } = useSessionPrompt(id, {
    enabled: on && state === "needs",
  });
  const { data: git } = useGitStatus(dir, { enabled: on });
  const agentList = useSubagents(id, on);
  const { data: servers } = useDevServersQuery();
  const { data: prData } = usePRStatus(on && rail ? dir : "");

  const entry = track(id, state, status?.lastLine);
  const { since, doing } = entry;

  const files = useMemo(() => {
    if (!git) return { count: 0, list: [] };
    // A file both staged and unstaged counts once
    const byPath = new Map<string, GitFile>();
    for (const f of [...git.staged, ...git.unstaged, ...git.untracked]) {
      if (!byPath.has(f.path)) byPath.set(f.path, f);
    }
    const list = [...byPath.values()];
    return { count: list.length, list };
  }, [git]);

  const agents = useMemo(
    () => ({
      list: agentList,
      running: agentList.filter((a) => a.status === "running").length,
    }),
    [agentList]
  );

  const devServer = useMemo(() => {
    if (!dir || !servers) return undefined;
    const mine = servers.filter((s) => sameDir(s.working_directory, dir));
    return mine.find((s) => s.status === "running") ?? mine[0];
  }, [servers, dir]);

  let now: SessionActivity["now"];
  if (state === "needs") {
    now = {
      label: "Waiting for your answer",
      command: prompt?.detail?.split("\n")[0]?.trim() || undefined,
      startedAt: since,
    };
  } else if (state === "work") {
    now = doing ?? { label: "Working", startedAt: since };
  } else {
    now = { label: STATE_WORD[state] };
  }

  const existing = prData?.existingPR;
  const pr = existing
    ? {
        number: existing.number,
        url: existing.url,
        status: existing.state.toLowerCase(),
        title: existing.title,
      }
    : session?.pr_number && session.pr_url
      ? {
          number: session.pr_number,
          url: session.pr_url,
          status: session.pr_status ?? "open",
        }
      : undefined;

  return {
    state,
    since,
    now,
    prompt: state === "needs" ? prompt : undefined,
    files,
    agents,
    devServer,
    pr,
  };
}

/** "m:ss" (or "h:mm:ss") since `startedAt`, ticking every second */
export function useElapsed(startedAt: number | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === undefined) return "";
  return formatElapsed(now - startedAt);
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
