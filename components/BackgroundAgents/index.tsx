"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Plus } from "lucide-react";
import { proxy, useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import {
  STATE_TEXT_CLASS,
  STATE_WORD,
  fromBackgroundState,
  timeAgo,
} from "@/lib/agent-state";
import { AgentRow, FoldedRow } from "@/components/rows/AgentRow";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isNative } from "@/lib/native-bridge";
import { closePage, openPage } from "@/stores/workspacePage";
import { openNew } from "@/stores/newSurface";
import type { BackgroundAgent } from "@/lib/claude-background";
import { AgentCrumb, AgentDetail } from "./AgentDetail";

const POLL_MS = 5000;

export const MODELS = [
  { id: "", label: "Default" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
];

export function stateWord(state: string): string {
  const mapped = fromBackgroundState(state);
  // Keep states the shared model doesn't know by their own name
  return mapped === "idle" && state !== "idle"
    ? state.charAt(0).toUpperCase() + state.slice(1)
    : STATE_WORD[mapped];
}

export function home(dir: string): string {
  return dir.replace(/^\/config(?=\/|$)/, "~");
}

let shared: BackgroundAgent[] = [];
/** Lists fetched so far, so an opened agent is known until the next one */
let polls = 0;
const listeners = new Set<(agents: BackgroundAgent[]) => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** Fetches the list now, e.g. right after starting one */
export async function poll() {
  try {
    const res = await fetch("/api/background-agents");
    const data = await res.json();
    // Parked sessions are listed as the sessions they are
    shared = ((data.agents ?? []) as BackgroundAgent[]).filter(
      (a) => !a.agentOsSessionId
    );
    polls++;
    listeners.forEach((listener) => listener(shared));
  } catch {
    // Keep the last list
  }
}

function pollOnShow() {
  if (document.visibilityState === "visible") poll();
}

/** One poll however many lists show the agents */
export function useBackgroundAgents() {
  const [agents, setAgents] = useState(shared);
  useEffect(() => {
    listeners.add(setAgents);
    if (listeners.size === 1) {
      poll();
      // Not while the tab is in the background: each poll may spawn the CLI
      timer = setInterval(() => {
        if (document.visibilityState === "visible") poll();
      }, POLL_MS);
      document.addEventListener("visibilitychange", pollOnShow);
    } else {
      setAgents(shared);
    }
    return () => {
      listeners.delete(setAgents);
      if (listeners.size) return;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", pollOnShow);
    };
  }, []);
  return agents;
}

/** The agents opened, as they were, for before the list has them */
const opened = new Map<string, { agent: BackgroundAgent; polls: number }>();

/** One agent, kept up to date; undefined once it's gone */
export function useBackgroundAgent(id: string): BackgroundAgent | undefined {
  const agents = useBackgroundAgents();
  const seen = opened.get(id);
  return (
    agents.find((a) => a.id === id) ??
    (seen && seen.polls === polls ? seen.agent : undefined)
  );
}

/** The agent in the phone's sheet */
const agentSheetStore = proxy<{ agentId: string | null }>({ agentId: null });

/**
 * Opens a background agent: as a page on the Duo (the app) and wider screens,
 * as the bottom sheet on a phone in a browser
 */
export function openBackgroundAgent(agent: BackgroundAgent) {
  opened.set(agent.id, { agent, polls });
  // The phone's sheet needs a list of agents on screen to host it
  if (isNative() || window.innerWidth >= 768 || !hosts.length) {
    openPage({ kind: "agent", agentId: agent.id });
  } else {
    agentSheetStore.agentId = agent.id;
  }
}

/**
 * Its Answer for now: the app runs `claude attach <id>` in the focused
 * terminal, which a page would cover
 */
export function attachBackgroundAgent(id: string) {
  closePage();
  window.dispatchEvent(
    new CustomEvent("agentos-attach-background", { detail: { id } })
  );
}

// Every list of agents can host the sheet; the first one mounted does
const hosts: symbol[] = [];
const hostListeners = new Set<() => void>();
function subscribeHosts(listener: () => void) {
  hostListeners.add(listener);
  return () => hostListeners.delete(listener);
}

function AgentSheetHost() {
  const [me] = useState(() => Symbol());
  const leads = useSyncExternalStore(
    subscribeHosts,
    () => hosts[0] === me,
    () => false
  );
  useEffect(() => {
    hosts.push(me);
    hostListeners.forEach((listener) => listener());
    return () => {
      hosts.splice(hosts.indexOf(me), 1);
      hostListeners.forEach((listener) => listener());
    };
  }, [me]);
  return leads ? <AgentSheet /> : null;
}

/** Whether `dir` is `folder` or inside it, either written with ~ */
function within(dir: string, folder: string): boolean {
  const a = home(dir).replace(/\/+$/, "");
  const b = home(folder).replace(/\/+$/, "");
  return a === b || a.startsWith(b + "/");
}

/**
 * The agents to list under each project: those running in its folder, each
 * under the deepest project that holds it
 */
export function useBackgroundAgentsByProject(
  projects: {
    id: string;
    working_directory: string;
    is_uncategorized: boolean;
  }[]
): Record<string, BackgroundAgent[]> {
  const agents = useBackgroundAgents();
  const byProject: Record<string, BackgroundAgent[]> = {};
  for (const agent of agents) {
    let best: { id: string; working_directory: string } | undefined;
    for (const project of projects) {
      if (project.is_uncategorized) continue;
      if (!within(agent.cwd, project.working_directory)) continue;
      if (
        !best ||
        home(project.working_directory).length >
          home(best.working_directory).length
      )
        best = project;
    }
    if (best) (byProject[best.id] ??= []).push(agent);
  }
  return byProject;
}

/** The age without "ago", for "oldest 92d" */
function age(ms: number): string {
  return timeAgo(ms, { dateAfterDays: Infinity }).replace(/ ago$/, "");
}

interface AgentItemProps {
  agent: BackgroundAgent;
  /** Shown in the subtitle when the list isn't already one project's */
  projectName?: string;
  noId?: boolean;
  dense?: boolean;
  /** A button of its own at the end (the row then can't be a button) */
  trailing?: ReactNode;
  className?: string;
}

function AgentItem({
  agent,
  projectName,
  noId,
  dense,
  trailing,
  className,
}: AgentItemProps) {
  const open = () => openBackgroundAgent(agent);
  return (
    <AgentRow
      {...(trailing && {
        as: "div" as const,
        role: "button",
        tabIndex: 0,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.target === e.currentTarget && e.key === "Enter") open();
        },
      })}
      trailing={trailing}
      kind="background"
      state={fromBackgroundState(agent.state)}
      title={agent.name}
      idLabel={noId ? undefined : agent.id.slice(0, 8)}
      project={projectName}
      // 0 means the state file didn't say
      detail={
        agent.startedAt
          ? `started ${timeAgo(agent.startedAt, { dateAfterDays: Infinity })}`
          : undefined
      }
      dense={dense}
      className={className}
      onClick={open}
    />
  );
}

/** One background agent's row: it opens the agent's page or sheet */
export function BackgroundAgentRow(props: AgentItemProps) {
  return (
    <>
      <AgentItem {...props} />
      <AgentSheetHost />
    </>
  );
}

/** What a folded group of agents is doing, e.g. "2 need you · 1 working" */
function summary(agents: BackgroundAgent[]): ReactNode {
  const counts = new Map<string, number>();
  for (const agent of agents)
    counts.set(agent.state, (counts.get(agent.state) ?? 0) + 1);
  const order = ["blocked", "working"];
  const states = [...counts.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9)
  );
  return states.map((state, i) => {
    const n = counts.get(state)!;
    const word =
      state === "blocked"
        ? `${n} need${n === 1 ? "s" : ""} you`
        : `${n} ${stateWord(state).toLowerCase()}`;
    return (
      <span key={state}>
        {i > 0 && " · "}
        <span className={STATE_TEXT_CLASS[fromBackgroundState(state)]}>
          {word}
        </span>
      </span>
    );
  });
}

/** Up to this many waiting agents show outside the folded group */
const LOOSE_WAITING = 2;

/**
 * A group of background agents, among sessions: one shows as a row; more
 * fold into one row that opens in place. Agents waiting for you stay out of
 * the fold, unless there are so many that they'd bury the sessions. Pass
 * projectName when the list isn't already that project's.
 */
export function BackgroundAgentGroup({
  agents,
  projectName,
  looseWaiting = LOOSE_WAITING,
  noId,
  dense,
  className,
}: {
  agents: BackgroundAgent[];
  projectName?: string;
  /** How many waiting agents may stay out of the fold; 0 folds any two */
  looseWaiting?: number;
  noId?: boolean;
  dense?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const waiting = agents.filter((a) => a.state === "blocked");
  const loose =
    agents.length === 1
      ? agents
      : waiting.length <= looseWaiting
        ? waiting
        : [];
  let folded = agents.filter((a) => !loose.includes(a));
  if (folded.length === 1) {
    loose.push(folded[0]);
    folded = [];
  }

  const row = (agent: BackgroundAgent, inFold?: boolean) => (
    <AgentItem
      key={agent.id}
      agent={agent}
      // The group's title already names the project
      projectName={inFold ? undefined : projectName}
      noId={noId}
      dense={dense}
    />
  );
  const oldest = Math.min(
    ...folded.map((a) => a.startedAt).filter((ms) => ms > 0)
  );

  return (
    <div className={cn("space-y-px", className)}>
      {loose.map((agent) => row(agent))}
      {folded.length > 0 && (
        <FoldedRow
          kind="background"
          state={
            folded.some((a) => a.state === "blocked")
              ? "needs"
              : folded.some((a) => a.state === "working")
                ? "work"
                : "idle"
          }
          title={
            projectName
              ? `${projectName} · ${folded.length} background agents`
              : `Background agents · ${folded.length}`
          }
          summary={
            <>
              {summary(folded)}
              {/* As every row's subtitle: state · project · detail */}
              {projectName && ` · ${projectName}`}
              {Number.isFinite(oldest) && ` · oldest ${age(oldest)}`}
            </>
          }
          open={expanded}
          onToggle={() => setExpanded(!expanded)}
          dense={dense}
        >
          <div className="space-y-px">
            {folded.map((agent) => row(agent, true))}
          </div>
        </FoldedRow>
      )}
      <AgentSheetHost />
    </div>
  );
}

/** A project's background agents, in its own list of sessions */
export function ProjectBackgroundAgents({
  agents,
}: {
  agents: BackgroundAgent[];
}) {
  return <BackgroundAgentGroup agents={agents} noId dense />;
}

/**
 * Claude Code's background agents (`claude --bg`): listed beside the
 * sessions, each with its output, a way into it, and Stop.
 */
export function BackgroundAgents({
  agents: only,
  title = "Background agents",
}: {
  /** Just these, rather than every agent */
  agents?: BackgroundAgent[];
  title?: string;
} = {}) {
  const all = useBackgroundAgents();
  const agents = only ?? all;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {title}
          {agents.length ? ` · ${agents.length}` : ""}
        </h2>
        <button
          type="button"
          onClick={() => openNew({ runAs: "background" })}
          className="text-primary active:bg-accent -mr-2 flex h-8 items-center gap-1 rounded-full px-2 text-xs font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>
      {agents.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Agents you start in the background run without a terminal and show up
          here.
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {agents.map((agent) => (
            <li key={agent.id}>
              <AgentItem agent={agent} projectName={home(agent.cwd)} />
            </li>
          ))}
        </ul>
      )}

      <AgentSheetHost />
    </section>
  );
}

/** A phone's background agent: AgentDetail in the bottom sheet */
function AgentSheet() {
  const { agentId } = useSnapshot(agentSheetStore);
  const agent = useBackgroundAgent(agentId ?? "");
  // Kept through the closing slide
  const [shown, setShown] = useState(agent);
  if (agent && agent !== shown) setShown(agent);
  const close = () => {
    agentSheetStore.agentId = null;
  };
  return (
    <Sheet open={!!agent} onOpenChange={(o) => !o && close()}>
      <SheetContent>
        {shown && (
          <>
            <SheetHeader>
              <SheetTitle className="truncate">{shown.name}</SheetTitle>
              <SheetDescription className="truncate">
                <AgentCrumb agent={shown} />
              </SheetDescription>
            </SheetHeader>
            <AgentDetail
              // Another agent starts fresh
              key={shown.id}
              agent={shown}
              layout="sheet"
              onClose={close}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
