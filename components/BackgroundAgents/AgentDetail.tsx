"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  STATE_TEXT_CLASS,
  fromBackgroundState,
  timeAgo,
} from "@/lib/agent-state";
import { confirmAction } from "@/components/ui/confirm";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";
import { backPage, closePage } from "@/stores/workspacePage";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { ChatItem } from "@/lib/claude-transcript";
import { home, poll, stateWord, useBackgroundAgent } from "./index";

type Output = { items?: ChatItem[]; logs?: string } | null;

/** "fusionha · background · 64711d80 · started 50d ago · Needs you" */
export function AgentCrumb({ agent }: { agent: BackgroundAgent }) {
  const folder = home(agent.cwd).replace(/\/+$/, "").split("/").pop();
  return (
    <>
      {[
        folder,
        "background",
        agent.id.slice(0, 8),
        // 0 means the state file didn't say
        agent.startedAt &&
          `started ${timeAgo(agent.startedAt, { dateAfterDays: Infinity })}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      {" · "}
      <span className={STATE_TEXT_CLASS[fromBackgroundState(agent.state)]}>
        {stateWord(agent.state)}
      </span>
    </>
  );
}

/**
 * A background agent: what it asks, its conversation, Open in terminal, Stop
 * and Remove. The page and the phone's sheet each give it their own header.
 */
export function AgentDetail({
  agent,
  layout,
  onClose,
}: {
  agent: BackgroundAgent;
  layout: "page" | "sheet";
  /** Leaving it: after Remove, or for the terminal (and after Stop in the sheet) */
  onClose: () => void;
}) {
  const [output, setOutput] = useState<Output>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const { id } = agent;
  const blocked = agent.state === "blocked";

  const load = useCallback(async () => {
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
    load();
  }, [load]);

  const end = async (remove: boolean) => {
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
        `/api/background-agents/${id}${remove ? "?remove=1" : ""}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(remove ? "Removed" : "Stopped");
      poll();
      // A stopped agent's page stays, to show it stopped
      if (remove || layout === "sheet") onClose();
      else load();
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

  // The app runs `claude attach <id>` in the focused terminal, which a page
  // would cover
  const attach = () => {
    if (layout === "page") closePage();
    else onClose();
    window.dispatchEvent(
      new CustomEvent("agentos-attach-background", { detail: { id } })
    );
  };

  // What it's waiting on: its last words, as it can't be answered here yet
  const asks = output?.items
    ?.filter((item) => item.kind === "assistant")
    .at(-1)?.text;

  // The sheet caps it; the page gives it the room under the question, so
  // the question stays in view
  const scrollClass =
    layout === "sheet"
      ? "max-h-[45dvh] overflow-auto"
      : "min-h-[120px] flex-1 overflow-auto";

  const body = (
    <>
      {blocked && (
        <div className="grid shrink-0 gap-2.5 rounded-2xl bg-gradient-to-b from-amber-400/[0.06] to-amber-400/[0.02] p-3.5 ring-1 ring-amber-400/35 ring-inset">
          <p className="line-clamp-6 text-sm break-words whitespace-pre-wrap">
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              Asks:
            </span>{" "}
            {asks ??
              (output === null ? "…" : "It's waiting for you to answer.")}
          </p>
          <button
            type="button"
            onClick={attach}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 text-[13px] font-semibold text-amber-950 active:opacity-80"
          >
            <SquareTerminal className="h-4 w-4" />
            Open in terminal
          </button>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Its conversation
        </span>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh"
          className="text-muted-foreground active:bg-accent hover:bg-accent flex h-8 w-8 items-center justify-center rounded-full"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>
      {output?.items ? (
        <Conversation items={output.items} className={scrollClass} />
      ) : (
        <pre
          className={cn(
            "bg-secondary/60 rounded-xl p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
            scrollClass
          )}
        >
          {output === null
            ? "Loading…"
            : output.logs?.trim() || "No output yet"}
        </pre>
      )}
    </>
  );

  const buttons = (
    <>
      {!blocked && (
        <button
          type="button"
          onClick={attach}
          className="bg-primary text-primary-foreground flex h-12 items-center justify-center gap-1.5 rounded-2xl text-sm font-semibold active:opacity-80"
        >
          <SquareTerminal className="h-4 w-4" />
          Open in terminal
        </button>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => end(false)}
          className="bg-secondary hover:bg-accent h-12 flex-1 rounded-2xl text-sm font-medium active:opacity-80 disabled:opacity-50"
        >
          Stop
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => end(true)}
          className="bg-secondary hover:bg-accent flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-sm font-medium text-red-500 active:opacity-80 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Remove
        </button>
      </div>
    </>
  );

  if (layout === "sheet") {
    return (
      <>
        <SheetBody className="space-y-2">{body}</SheetBody>
        <SheetFooter>{buttons}</SheetFooter>
      </>
    );
  }
  return (
    <>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        {body}
      </div>
      <footer className="fold-controls border-border shrink-0 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto grid w-full max-w-3xl gap-2">{buttons}</div>
      </footer>
    </>
  );
}

/** Its latest messages and tool calls, newest at the bottom */
function Conversation({
  items,
  className,
}: {
  items: ChatItem[];
  className?: string;
}) {
  if (!items.length) {
    return <p className="text-muted-foreground text-sm">No messages yet</p>;
  }
  return (
    <div
      ref={(el) => el?.scrollTo({ top: el.scrollHeight })}
      className={cn(
        "bg-secondary/60 space-y-2 rounded-xl p-3 text-[13px] leading-relaxed",
        className
      )}
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

/** A background agent as a page: its question first */
export function AgentDetailPage({ page }: PageProps<"agent">) {
  const agent = useBackgroundAgent(page.agentId);
  if (!agent) {
    return (
      <>
        <PageHeader title="Background agent" />
        <PageEmpty>This agent is gone.</PageEmpty>
      </>
    );
  }
  return (
    <>
      <PageHeader title={agent.name} subtitle={<AgentCrumb agent={agent} />} />
      <AgentDetail agent={agent} layout="page" onClose={backPage} />
    </>
  );
}
