"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FolderOpen, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  STATE_TEXT_CLASS,
  STATE_WORD,
  fromBackgroundState,
  timeAgo,
} from "@/lib/agent-state";
import { AgentRow, FoldedRow } from "@/components/rows/AgentRow";
import { confirmAction } from "@/components/ui/confirm";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { ChatItem } from "@/lib/claude-transcript";

const POLL_MS = 5000;

export const MODELS = [
  { id: "", label: "Default" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
];

function stateWord(state: string): string {
  const mapped = fromBackgroundState(state);
  // Keep states the shared model doesn't know by their own name
  return mapped === "idle" && state !== "idle"
    ? state.charAt(0).toUpperCase() + state.slice(1)
    : STATE_WORD[mapped];
}

function home(dir: string): string {
  return dir.replace(/^\/config(?=\/|$)/, "~");
}

let shared: BackgroundAgent[] = [];
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
    listeners.forEach((listener) => listener(shared));
  } catch {
    // Keep the last list
  }
}

/** One poll however many lists show the agents */
export function useBackgroundAgents() {
  const [agents, setAgents] = useState(shared);
  useEffect(() => {
    listeners.add(setAgents);
    if (listeners.size === 1) {
      poll();
      timer = setInterval(poll, POLL_MS);
    } else {
      setAgents(shared);
    }
    return () => {
      listeners.delete(setAgents);
      if (!listeners.size) clearInterval(timer);
    };
  }, []);
  return agents;
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
  className?: string;
}

function AgentItem({
  agent,
  projectName,
  noId,
  dense,
  className,
  onOpen,
}: AgentItemProps & { onOpen: () => void }) {
  return (
    <AgentRow
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
      onClick={onOpen}
    />
  );
}

/** One background agent's row, with its own sheet for output and Stop */
export function BackgroundAgentRow(props: AgentItemProps) {
  const [open, setOpen] = useState<BackgroundAgent | null>(null);
  return (
    <>
      <AgentItem {...props} onOpen={() => setOpen(props.agent)} />
      <AgentSheet agent={open} onClose={() => setOpen(null)} onChanged={poll} />
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
}: {
  agents: BackgroundAgent[];
  projectName?: string;
  /** How many waiting agents may stay out of the fold; 0 folds any two */
  looseWaiting?: number;
  noId?: boolean;
  dense?: boolean;
}) {
  const [open, setOpen] = useState<BackgroundAgent | null>(null);
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
      onOpen={() => setOpen(agent)}
    />
  );
  const oldest = Math.min(
    ...folded.map((a) => a.startedAt).filter((ms) => ms > 0)
  );

  return (
    <div className="space-y-px">
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
      <AgentSheet agent={open} onClose={() => setOpen(null)} onChanged={poll} />
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

/** "New background agent" from a project: its folder filled in */
export function NewBackgroundAgentSheet({
  cwd,
  onClose,
}: {
  cwd: string | null;
  onClose: () => void;
}) {
  return (
    <NewAgentSheet
      open={cwd !== null}
      initialCwd={cwd ?? undefined}
      onClose={onClose}
      onStarted={poll}
    />
  );
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
  const [open, setOpen] = useState<BackgroundAgent | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {title}
          {agents.length ? ` · ${agents.length}` : ""}
        </h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
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
              <AgentItem
                agent={agent}
                projectName={home(agent.cwd)}
                onOpen={() => setOpen(agent)}
              />
            </li>
          ))}
        </ul>
      )}

      <AgentSheet agent={open} onClose={() => setOpen(null)} onChanged={poll} />
      <NewAgentSheet
        open={creating}
        onClose={() => setCreating(false)}
        onStarted={poll}
      />
    </section>
  );
}

function AgentSheet({
  agent,
  onClose,
  onChanged,
}: {
  agent: BackgroundAgent | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [output, setOutput] = useState<{
    items?: ChatItem[];
    logs?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = agent?.id;

  const loadLogs = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/background-agents/${id}`);
      const data = await res.json();
      setOutput(
        data.items
          ? { items: data.items }
          : { logs: data.logs ?? data.error ?? "" }
      );
    } catch {
      setOutput({ logs: "Couldn't load its output" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setOutput(null);
    loadLogs();
  }, [loadLogs]);

  const end = async (remove: boolean) => {
    if (!agent) return;
    const ok = await confirmAction(
      remove
        ? {
            title: `Remove ${agent.name}?`,
            message:
              "It is stopped and deleted, with its worktree if it has one. Its conversation can't be opened again.",
            confirmLabel: "Remove",
            destructive: true,
          }
        : {
            title: `Stop ${agent.name}?`,
            message:
              "It stops working. Its conversation is kept, and Open brings it back.",
            confirmLabel: "Stop",
          }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/background-agents/${agent.id}${remove ? "?remove=1" : ""}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(remove ? "Removed" : "Stopped");
      onChanged();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "That didn't work"
      );
    } finally {
      setBusy(false);
    }
  };

  // The page runs `claude attach <id>` in the focused terminal
  const attach = () => {
    if (!agent) return;
    window.dispatchEvent(
      new CustomEvent("agentos-attach-background", {
        detail: { id: agent.id },
      })
    );
    onClose();
  };

  return (
    <Sheet open={!!agent} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="truncate">{agent?.name}</SheetTitle>
          <SheetDescription className="truncate">
            {agent && `${stateWord(agent.state)} · ${home(agent.cwd)}`}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Recent output
            </span>
            <button
              type="button"
              onClick={loadLogs}
              aria-label="Refresh output"
              className="text-muted-foreground active:bg-accent flex h-8 w-8 items-center justify-center rounded-full"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
          {output?.items ? (
            <Conversation items={output.items} />
          ) : (
            <pre className="bg-secondary/60 max-h-[45dvh] overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {output === null
                ? "Loading…"
                : output.logs?.trim() || "No output yet"}
            </pre>
          )}
        </SheetBody>
        <SheetFooter>
          <button
            type="button"
            onClick={attach}
            className="bg-primary text-primary-foreground h-12 rounded-2xl text-sm font-semibold active:opacity-80"
          >
            Open in terminal
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => end(false)}
              className="bg-secondary h-12 flex-1 rounded-2xl text-sm font-medium active:opacity-80 disabled:opacity-50"
            >
              Stop
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => end(true)}
              className="bg-secondary h-12 flex-1 rounded-2xl text-sm font-medium text-red-500 active:opacity-80 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Its latest messages and tool calls, newest at the bottom */
function Conversation({ items }: { items: ChatItem[] }) {
  if (!items.length) {
    return <p className="text-muted-foreground text-sm">No messages yet</p>;
  }
  return (
    <div
      ref={(el) => el?.scrollTo({ top: el.scrollHeight })}
      className="bg-secondary/60 max-h-[45dvh] space-y-2 overflow-auto rounded-xl p-3 text-[13px] leading-relaxed"
    >
      {items.map((item) =>
        item.kind === "tool" ? (
          <p
            key={item.id}
            className="text-muted-foreground truncate font-mono text-[11px]"
          >
            {item.name} {item.summary}
          </p>
        ) : item.kind === "result" ? null : (
          <p
            key={item.id}
            className={cn(
              "break-words whitespace-pre-wrap",
              item.kind === "user" && "text-primary",
              item.kind === "summary" && "text-muted-foreground line-clamp-3"
            )}
          >
            {item.text}
          </p>
        )
      )}
    </div>
  );
}

function NewAgentSheet({
  open,
  initialCwd,
  onClose,
  onStarted,
}: {
  open: boolean;
  initialCwd?: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [cwd, setCwd] = useState(initialCwd ?? "~/workspace");
  useEffect(() => {
    if (open && initialCwd) setCwd(initialCwd);
  }, [open, initialCwd]);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, prompt, model: model || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Started in the background");
      setPrompt("");
      onStarted();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't start it"
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New background agent</SheetTitle>
            <SheetDescription>
              Claude works on the task without a terminal. Open it any time.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Folder</span>
              <span className="flex gap-2">
                <input
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="bg-secondary/70 focus:ring-primary h-11 min-w-0 flex-1 rounded-xl px-3 font-mono text-sm outline-none focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  aria-label="Choose a folder"
                  className="bg-secondary/70 active:bg-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Task</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="What should it do?"
                className="bg-secondary/70 focus:ring-primary w-full resize-none rounded-xl px-3 py-2.5 text-base outline-none focus:ring-2"
              />
            </label>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Model</span>
              <div className="flex gap-2">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={model === m.id}
                    onClick={() => setModel(m.id)}
                    className={cn(
                      "h-9 flex-1 rounded-full border text-xs font-medium",
                      model === m.id
                        ? "bg-accent text-foreground border-transparent"
                        : "border-border text-muted-foreground"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <button
              type="button"
              onClick={start}
              disabled={!prompt.trim() || !cwd.trim() || starting}
              className="bg-primary text-primary-foreground flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-semibold active:opacity-80 disabled:opacity-50"
            >
              {starting && <Loader2 className="h-4 w-4 animate-spin" />}
              Start
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <DirectoryPicker
        open={picking}
        onClose={() => setPicking(false)}
        onSelect={(path) => {
          setCwd(path);
          setPicking(false);
        }}
        initialPath={cwd}
      />
    </>
  );
}
