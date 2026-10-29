import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSnapshot } from "valtio";
import type { DevServer, Session } from "@/lib/db";
import type { GitFile } from "@/lib/git-status";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowInfo } from "@/lib/claude-workflows";
import type { PermissionPrompt } from "@/lib/permission-prompt";
import type { PlanResponse, PlanState } from "@/lib/claude-plan";
import type { SessionStatus } from "@/components/views/types";
import {
  dbTimeMs,
  fromSessionStatus,
  sessionState,
  STATE_WORD,
  type AgentState,
} from "@/lib/agent-state";
import { limitStateOf } from "@/lib/limits/types";
import { resetTime } from "@/components/Chat/limited-model";
import { mobileNavStore } from "@/stores/mobileNav";
import { useGitStatus, usePRStatus } from "@/data/git/queries";
import { useDevServersQuery } from "@/data/dev-servers";
import { useSessionPrompt } from "@/data/prompts/queries";
import { useSubagents, useWorkflows } from "./useSubagents";
import { useSharedPoll } from "./useSharedPoll";

export interface SessionActivity {
  state: AgentState;
  /** When the session entered this state, as seen by this client */
  since: number;
  now: { label: string; command?: string; startedAt?: number };
  /** The prompt it's waiting on: undefined while loading or not waiting */
  prompt?: PermissionPrompt | null;
  files: { count: number; list: GitFile[] };
  agents: { list: SubagentInfo[]; running: number };
  workflows: { list: WorkflowInfo[]; running: number };
  devServer?: DevServer;
  pr?: { number: number; url: string; status: string; title?: string };
  /** Claude's plan (lib/claude-plan.ts, GET /plan), with `rail` or `plan` (M2) */
  plan?: PlanState | null;
  /** Context tokens, as "41k tokens" in the Live activity (M2) */
  tokens?: number | null;
}

const PLAN_POLL_MS = 5000;

export const planKeys = {
  session: (sessionId: string) => ["plan", sessionId] as const,
};

const NO_PLAN: PlanResponse = { plan: null, tokens: null };

// No plan (or no route yet) reads as none rather than an error
async function fetchPlan(sessionId: string): Promise<PlanResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/plan`);
  if (!res.ok) return NO_PLAN;
  const body = (await res.json()) as Partial<PlanResponse>;
  return { plan: body.plan ?? null, tokens: body.tokens ?? null };
}

/** Claude's plan and context tokens, one poll for every view of a session */
function usePlan(sessionId: string, enabled: boolean) {
  const queryKey = planKeys.session(sessionId);
  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchPlan(sessionId),
    enabled,
    staleTime: PLAN_POLL_MS,
  });
  useSharedPoll(queryKey, PLAN_POLL_MS, enabled);
  return enabled ? data : undefined;
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

type Doing = { label: string; command?: string };

/**
 * What the pane's recent lines say Claude is doing: the latest tool line
 * ("● Bash(npm run build)") and the spinner verb, each when it can tell
 */
export function parseRecentLines(lines: readonly string[] | undefined): {
  tool?: Doing;
  spinner?: Doing;
} {
  const found: { tool?: Doing; spinner?: Doing } = {};
  for (let i = (lines?.length ?? 0) - 1; i >= 0; i--) {
    const line = lines![i];
    if (!found.spinner) {
      const spinner = SPINNER_LINE.exec(line);
      if (spinner) found.spinner = { label: spinner[1] };
    }
    if (!found.tool) {
      const tool = TOOL_LINE.exec(line);
      // A one-word reply ("● Done") isn't a tool
      if (tool && (tool[2] !== undefined || tool[1] in TOOL_VERB)) {
        const command = tool[2]?.trim();
        found.tool = {
          label: TOOL_VERB[tool[1]] ?? tool[1],
          command: command || undefined,
        };
      }
    }
    if (found.tool && found.spinner) break;
  }
  return found;
}

// Kept per session across mounts, so the strip and the rail agree on the
// clock and a command doesn't vanish when the next poll shows the footer
const tracked = new Map<
  string,
  {
    state: AgentState;
    since: number;
    doing?: Doing & { startedAt: number; fromTool: boolean };
  }
>();

function track(
  sessionId: string,
  state: AgentState,
  lines: readonly string[] | undefined,
  /** The server's last change (ms): the clock's start when first seen */
  seed: number | null
) {
  let entry = tracked.get(sessionId);
  if (!entry || entry.state !== state) {
    // Seen changing here: now. First seen: since the server's last change,
    // not since the page loaded
    const now = Date.now();
    const since =
      !entry && seed !== null && !Number.isNaN(seed)
        ? Math.min(seed, now)
        : now;
    entry = { state, since };
    tracked.set(sessionId, entry);
  }
  if (state !== "work") return entry;
  const { tool, spinner } = parseRecentLines(lines);
  const doing = entry.doing;
  if (tool) {
    // A new tool restarts the clock
    if (tool.label !== doing?.label || tool.command !== doing?.command) {
      // The first step seen in this state started no later than the state
      entry.doing = {
        ...tool,
        startedAt: doing ? Date.now() : entry.since,
        fromTool: true,
      };
    }
  } else if (spinner && !doing?.fromTool) {
    // The spinner only names the spell until a tool shows; its verb
    // changing isn't a new step
    entry.doing = {
      ...spinner,
      startedAt: doing?.startedAt ?? entry.since,
      fromTool: false,
    };
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
 * (a GitHub call) only with `rail`, the plan and tokens with `rail` or
 * `plan`.
 */
export function useSessionActivity(
  session: Session | undefined,
  {
    active = true,
    rail = false,
    plan: withPlan = false,
  }: {
    active?: boolean;
    rail?: boolean;
    /** Also read the plan and tokens without the rest of the rail (M2) */
    plan?: boolean;
  } = {}
): SessionActivity {
  const id = session?.id ?? "";
  const dir = session?.working_directory ?? "";
  const { statuses } = useSnapshot(mobileNavStore);
  const status = statuses[id] as SessionStatus | undefined;
  // At a usage limit it is Limited, not waiting for you (M6)
  const state = session
    ? sessionState(session, status?.status)
    : fromSessionStatus(status?.status ?? "idle");
  const on = active && !!session;

  const { data: prompt } = useSessionPrompt(id, {
    enabled: on && state === "needs",
  });
  const { data: git } = useGitStatus(dir, { enabled: on });
  const agentList = useSubagents(id, on);
  const workflowList = useWorkflows(id, on);
  const { data: servers } = useDevServersQuery();
  const { data: prData } = usePRStatus(on && rail ? dir : "");
  // Claude's transcript has the plan; other agents have none
  const planOn =
    on && (rail || withPlan) && (session?.agent_type || "claude") === "claude";
  const planData = usePlan(id, planOn);

  const entry = track(
    id,
    state,
    status?.recentLines ?? (status?.lastLine ? [status.lastLine] : undefined),
    session?.updated_at ? dbTimeMs(session.updated_at) : null
  );
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

  const workflows = useMemo(
    () => ({
      list: workflowList,
      running: workflowList.filter((w) => w.status === "running").length,
    }),
    [workflowList]
  );

  const devServer = useMemo(() => {
    if (!dir || !servers) return undefined;
    const mine = servers.filter((s) => sameDir(s.working_directory, dir));
    return mine.find((s) => s.status === "running") ?? mine[0];
  }, [servers, dir]);

  let now: SessionActivity["now"];
  if (state === "needs") {
    now = {
      // No question on screen: its turn ended and the next message is yours
      label: prompt === null ? "Your turn" : "Waiting for your answer",
      command: prompt?.detail?.split("\n")[0]?.trim() || undefined,
      startedAt: since,
    };
  } else if (state === "work") {
    now = doing
      ? {
          label: doing.label,
          command: doing.command,
          startedAt: doing.startedAt,
        }
      : { label: "Working", startedAt: since };
  } else if (state === "limited" && session) {
    // "Limited · resets 3:40 pm"
    const at = resetTime(limitStateOf(session).limitedUntil);
    now = { label: at ? `Limited · resets ${at}` : "Limited" };
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
    workflows,
    devServer,
    pr,
    plan: planOn ? (planData?.plan ?? null) : undefined,
    tokens: planOn ? (planData?.tokens ?? null) : undefined,
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
