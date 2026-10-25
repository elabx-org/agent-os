"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

const MODELS = [
  { id: "", label: "Default" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
];

// Blocked means it stopped to ask: the same amber as a waiting session
function stateLook(state: string): { dot: string; word: string } {
  switch (state) {
    case "working":
      return { dot: "bg-blue-400 ring-4 ring-blue-400/20", word: "Working" };
    case "blocked":
      return {
        dot: "bg-amber-400 ring-4 ring-amber-400/20",
        word: "Needs you",
      };
    default:
      return {
        dot: "bg-muted-foreground/60",
        word: state.charAt(0).toUpperCase() + state.slice(1),
      };
  }
}

function home(dir: string): string {
  return dir.replace(/^\/config(?=\/|$)/, "~");
}

/**
 * Claude Code's background agents (`claude --bg`): listed beside the
 * sessions, each with its output, a way into it, and Stop.
 */
export function BackgroundAgents() {
  const [agents, setAgents] = useState<BackgroundAgent[]>([]);
  const [open, setOpen] = useState<BackgroundAgent | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/background-agents");
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      // Keep the last list
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Background agents{agents.length ? ` · ${agents.length}` : ""}
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
          {agents.map((agent) => {
            const look = stateLook(agent.state);
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => setOpen(agent)}
                  className="active:bg-accent flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-2 w-2 shrink-0 rounded-full", look.dot)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {agent.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      <span
                        className={cn(
                          agent.state === "working" && "text-blue-400",
                          agent.state === "blocked" && "text-amber-400"
                        )}
                      >
                        {look.word}
                      </span>
                      {" · "}
                      {home(agent.cwd)}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                    {agent.id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AgentSheet
        agent={open}
        onClose={() => setOpen(null)}
        onChanged={refresh}
      />
      <NewAgentSheet
        open={creating}
        onClose={() => setCreating(false)}
        onStarted={refresh}
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
            {agent && `${stateLook(agent.state).word} · ${home(agent.cwd)}`}
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
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [cwd, setCwd] = useState("~/workspace");
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
