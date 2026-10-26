"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Pencil,
  ShieldQuestion,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClaudeState } from "@/hooks/useClaudeState";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import { readClaudeScreen, type ClaudeScreen } from "@/lib/claude-screen";
import type { ClaudeState, ClaudeTool } from "@/lib/claude-state";
import type { ChatItem } from "@/lib/claude-transcript";
import type { HistoryEntry } from "@/hooks/useComposerData";
import { GROUP_HEADING, POPOVER } from "./SuggestionPopover";
import { usePopoverPlacement } from "./usePopoverPlacement";

/** The keys that change Claude's state, passed straight through */
export type ClaudeKey = "shift-tab" | "esc" | "esc-esc" | "up";

const SCREEN_POLL_MS = 1500;
const LOCAL_READ_MS = 500;
/** A second Esc within this opens the rewind list, as in Claude Code */
const ESC_ESC_MS = 600;

// Shift+Tab's order in Claude Code; auto and bypass only when allowed
const NEXT_MODE: Record<string, string> = {
  default: "acceptEdits",
  acceptEdits: "plan",
};

interface ClaudeLiveOptions {
  sessionId: string | null | undefined;
  /** Only Claude sessions have any of this */
  claude: boolean;
  active?: boolean;
  /** The terminal's visible rows; without it the server reads the pane */
  readScreen?: () => readonly string[] | null;
  /** Sends keys to Claude; without it, through the server */
  sendKey?: (key: ClaudeKey, times?: number) => void;
}

/**
 * Claude Code's live state for the composer: the hooks' record (status
 * line, pending permission) plus what it draws at the bottom of the pane
 * (mode, spinner, queued messages), and the keys that change it.
 */
export function useClaudeLive({
  sessionId,
  claude,
  active = true,
  readScreen,
  sendKey,
}: ClaudeLiveOptions) {
  const state = useClaudeState(claude ? sessionId : null, active);

  // The terminal's own rows, read often since it's cheap
  const [local, setLocal] = useState<ClaudeScreen | null>(null);
  const reading = !!readScreen && claude && active;
  useEffect(() => {
    if (!reading || !readScreen) {
      setLocal(null);
      return;
    }
    let last = "";
    const read = () => {
      if (document.hidden) return;
      const lines = readScreen();
      const next = lines ? readClaudeScreen(lines) : null;
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      setLocal(next);
    };
    read();
    const timer = setInterval(read, LOCAL_READ_MS);
    return () => clearInterval(timer);
  }, [reading, readScreen]);

  // No terminal here (chat): the server captures the pane
  const remote = !readScreen && claude && active && !!sessionId;
  const screenKey = ["claude-screen", sessionId ?? ""] as const;
  const { data: remoteScreen } = useQuery({
    queryKey: screenKey,
    queryFn: async (): Promise<ClaudeScreen | null> => {
      const res = await fetch(`/api/sessions/${sessionId}/screen`);
      if (!res.ok) return null;
      return (await res.json()).screen ?? null;
    },
    enabled: remote,
    staleTime: SCREEN_POLL_MS,
  });
  useSharedPoll(screenKey, SCREEN_POLL_MS, remote);
  const screen = readScreen ? local : remote ? (remoteScreen ?? null) : null;

  const send = useCallback(
    (key: ClaudeKey, times = 1) => {
      if (sendKey) return sendKey(key, times);
      if (!sessionId) return;
      fetch(`/api/sessions/${sessionId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, times }),
      }).catch(() => {});
    },
    [sendKey, sessionId]
  );

  // The footer is right after Shift+Tab; the hooks only say on the next turn
  const seen = screen?.mode ?? state.mode;
  // Plan cycles on to auto or bypass once the session has shown it has one
  const others = useRef<string | null>(null);
  useEffect(() => {
    if (seen === "auto" || seen === "bypassPermissions") others.current = seen;
  }, [seen]);
  // Shift+Tab advances the label at once; the screen confirms or corrects
  const [optimistic, setOptimistic] = useState<{
    mode: string;
    from: string | null;
  } | null>(null);
  useEffect(() => {
    if (optimistic && seen !== optimistic.from) setOptimistic(null);
  }, [seen, optimistic]);
  useEffect(() => {
    if (!optimistic) return;
    const timer = setTimeout(() => setOptimistic(null), 2500);
    return () => clearTimeout(timer);
  }, [optimistic]);
  const mode = optimistic?.mode ?? seen;

  const cycleMode = useCallback(() => {
    send("shift-tab");
    const current = mode ?? "default";
    setOptimistic({
      mode:
        NEXT_MODE[current] ??
        (current === "plan" && others.current ? others.current : "default"),
      from: seen,
    });
  }, [send, mode, seen]);

  const [rewindOpen, setRewindOpen] = useState(false);
  const lastEsc = useRef(0);
  /** Esc interrupts; a second one opens the rewind list */
  const escape = useCallback(() => {
    const now = Date.now();
    if (now - lastEsc.current < ESC_ESC_MS) {
      lastEsc.current = 0;
      setRewindOpen(true);
      return;
    }
    lastEsc.current = now;
    send("esc");
  }, [send]);

  /** Shift+Tab and Esc in the box go to Claude, as in its own input */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!claude || e.nativeEvent.isComposing) return false;
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        cycleMode();
        return true;
      }
      if (e.key === "Escape" && !e.shiftKey) {
        e.preventDefault();
        escape();
        return true;
      }
      return false;
    },
    [claude, cycleMode, escape]
  );

  return {
    claude,
    sessionId,
    state,
    screen,
    mode,
    send,
    cycleMode,
    escape,
    rewindOpen,
    setRewindOpen,
    onKeyDown,
  };
}

export type ClaudeLive = ReturnType<typeof useClaudeLive>;

const G2 = (
  <svg width="13" height="9" viewBox="0 0 13 9" fill="currentColor">
    <path d="M0 0l6 4.5L0 9zM7 0l6 4.5L7 9z" />
  </svg>
);
const PAUSE = (
  <svg width="8" height="9" viewBox="0 0 8 9" fill="currentColor">
    <rect width="3" height="9" />
    <rect x="5" width="3" height="9" />
  </svg>
);

// Claude Code's own labels and colours (its dark terminal's, and darker ones
// that stay legible in the light theme); default mode shows nothing
const MODE_LABEL: Record<
  string,
  { icon: React.ReactNode; label: string; className: string }
> = {
  acceptEdits: {
    icon: G2,
    label: "accept edits on",
    className:
      "bg-[#7A3FD1]/10 text-[#7A3FD1] dark:bg-[#AF87FF]/12 dark:text-[#AF87FF]",
  },
  plan: {
    icon: PAUSE,
    label: "plan mode on",
    className:
      "bg-[#2B6E66]/10 text-[#2B6E66] dark:bg-[#48968C]/14 dark:text-[#48968C]",
  },
  auto: {
    icon: G2,
    label: "auto mode on",
    className:
      "bg-[#8A5A00]/10 text-[#8A5A00] dark:bg-[#E0A54B]/12 dark:text-[#E0A54B]",
  },
  bypassPermissions: {
    icon: G2,
    label: "bypass permissions on",
    className:
      "bg-[#B4233A]/10 text-[#B4233A] dark:bg-[#FF6B80]/12 dark:text-[#FF6B80]",
  },
  dontAsk: {
    icon: G2,
    label: "don't ask on",
    className: "bg-secondary text-muted-foreground",
  },
};

/**
 * What the user's own status line prints, or model · context · cost from the
 * JSON Claude last gave it when they have none
 */
function statusText(state: ClaudeState): string {
  const s = state.status;
  if (!s) return "";
  if (s.line) return s.line;
  const used = s.context_window?.used_percentage;
  const cost = s.cost?.total_cost_usd;
  return [
    s.model?.display_name,
    typeof used === "number" ? `${Math.round(used)}%` : null,
    typeof cost === "number" && cost > 0 ? `$${cost.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const ROW =
  "flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] leading-4 whitespace-nowrap text-muted-foreground/80";
// Small to look at, the size of a finger to press (16px + 28 = 44)
const HIT = "relative after:absolute after:-inset-x-1 after:-inset-y-3.5";

/**
 * Under the box, as under Claude Code's: the permission mode (tap cycles
 * it, as Shift+Tab), the spinner with Esc while it works, and the status
 * line. Shows nothing it doesn't know.
 */
export function ClaudeStateBar({
  live,
  className,
}: {
  live: ClaudeLive;
  className?: string;
}) {
  if (!live.claude) return null;
  const mode = live.mode ? MODE_LABEL[live.mode] : undefined;
  const spinner = live.screen?.spinner;
  const status = statusText(live.state);
  if (!mode && !spinner && !status) return null;

  const modePill = mode && (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={live.cycleMode}
      title="Shift+Tab to cycle"
      aria-label={`${mode.label}, tap to change mode`}
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-1.5 rounded-full px-2 active:opacity-70",
        HIT,
        mode.className
      )}
    >
      {mode.icon}
      {mode.label}
    </button>
  );
  const statusSpan = status && (
    <span className="ml-auto min-w-0 truncate">{status}</span>
  );

  return (
    <div className={cn("flex flex-col gap-1 pt-1.5 pr-2 pl-12", className)}>
      {(modePill || spinner) && (
        <div className={ROW}>
          {modePill}
          {spinner && (
            <>
              <span className="min-w-0 truncate text-[#B5532F] dark:text-[#D77757]">
                ✻ {spinner.verb}…{" "}
                <span className="text-muted-foreground/80">
                  {spinner.elapsed ? `${spinner.elapsed} · ` : ""}esc to
                  interrupt
                </span>
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={live.escape}
                title="Esc interrupts; twice opens rewind"
                className={cn(
                  "bg-secondary text-foreground inline-flex h-4 shrink-0 items-center gap-1 rounded-full px-2 font-sans active:opacity-70",
                  HIT
                )}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                Esc
              </button>
            </>
          )}
          {!spinner && statusSpan}
        </div>
      )}
      {status && (!(modePill || spinner) || spinner) && (
        <div className={ROW}>{statusSpan}</div>
      )}
    </div>
  );
}

/**
 * Messages Claude holds until its turn ends, dimmed above the box. Edit
 * and cancel take them back from Claude, where the terminal can.
 */
export function QueuedMessages({
  live,
  known,
  onEdit,
  onCancel,
}: {
  live: ClaudeLive;
  /** What this composer sent while Claude worked, if it kept track */
  known?: string[];
  onEdit?: () => void;
  onCancel?: () => void;
}) {
  const screen = live.screen;
  if (!live.claude || !screen?.hasQueued) return null;
  const mine = !!known?.length;
  const texts = mine ? known : screen.queued;
  if (!texts.length) return null;
  const action =
    "text-muted-foreground active:bg-accent hover:bg-accent relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full after:absolute after:-inset-1.5";
  return (
    <div
      className="border-border text-muted-foreground mb-1.5 ml-12 flex items-center gap-2 rounded-[14px] border border-dashed py-1 pr-1 pl-3 text-[12.5px]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <em className="text-muted-foreground/70 shrink-0 text-[9.5px] tracking-[0.06em] uppercase not-italic">
        queued
      </em>
      <div className="flex min-w-0 flex-1 flex-col py-1">
        {texts.map((text, i) => (
          <span key={i} className="truncate">
            {text}
          </span>
        ))}
      </div>
      {mine && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit queued messages"
          title="Back into the box"
          className={action}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {mine && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel queued messages"
          title="Don't send"
          className={action}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

const WHEN = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(at: number): string {
  if (!at) return "";
  const s = (at - Date.now()) / 1000;
  if (s > -60) return "now";
  if (s > -3600) return WHEN.format(Math.round(s / 60), "minute");
  if (s > -86400) return WHEN.format(Math.round(s / 3600), "hour");
  return WHEN.format(Math.round(s / 86400), "day");
}

/** This conversation's prompts, newest first, as Claude's rewind lists them */
async function fetchPrompts(
  sessionId: string,
  cwd: string | null | undefined,
  claudeSessionId: string | null
): Promise<{ text: string; at: number }[]> {
  // history.jsonl has every prompt, queued ones too, by Claude session
  if (cwd && claudeSessionId) {
    const res = await fetch(
      `/api/claude/history?project=${encodeURIComponent(cwd)}&session=${encodeURIComponent(claudeSessionId)}&limit=100`
    );
    if (res.ok) {
      const { entries } = (await res.json()) as { entries?: HistoryEntry[] };
      if (entries?.length)
        return entries.map((e) => ({ text: e.text, at: e.timestamp }));
    }
  }
  // Before the hooks have said which session it is: the transcript, which
  // misses messages queued mid-turn
  const res = await fetch(`/api/sessions/${sessionId}/transcript`);
  if (!res.ok) return [];
  const { items } = (await res.json()) as { items?: ChatItem[] };
  return (items ?? [])
    .flatMap((i) =>
      i.kind === "user" ? [{ text: i.text, at: Date.parse(i.ts) || 0 }] : []
    )
    .reverse();
}

const RESTORE =
  "inline-flex min-h-7 items-center rounded-full px-3 text-xs select-none";

/**
 * Esc Esc: this conversation's prompts, newest first. Choosing one opens
 * Claude Code's own rewind list on it; Claude then asks what to restore.
 */
export function RewindSheet({
  live,
  cwd,
  onRewound,
}: {
  live: ClaudeLive;
  cwd: string | null | undefined;
  /** After the keys went: where Claude's confirmation can be seen */
  onRewound?: () => void;
}) {
  const { rewindOpen, setRewindOpen, sessionId, send } = live;
  const claudeSessionId = live.state.claudeSessionId;
  const { data: prompts, isLoading } = useQuery({
    queryKey: ["rewind-prompts", sessionId ?? "", claudeSessionId ?? ""],
    queryFn: () => fetchPrompts(sessionId!, cwd, claudeSessionId),
    enabled: rewindOpen && !!sessionId,
    staleTime: 0,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rewindOpen) return;
    const close = () => setRewindOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    // Before the box's own Esc, which would go to Claude
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [rewindOpen, setRewindOpen]);

  // Opens away from the fold, as the composer's other popovers
  const { below, maxHeight } = usePopoverPlacement(
    rootRef,
    rewindOpen && live.claude
  );

  if (!rewindOpen || !live.claude) return null;

  // Claude's list opens on "(current)"; each Up is one prompt further back
  const choose = (index: number) => {
    setRewindOpen(false);
    send("esc-esc");
    setTimeout(() => send("up", index + 1), 500);
    onRewound?.();
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        POPOVER,
        "absolute inset-x-0 z-50 overflow-y-auto overscroll-contain",
        below ? "top-full mt-2" : "bottom-full mb-2"
      )}
      style={{ maxHeight }}
    >
      <div className={GROUP_HEADING}>Rewind · Esc Esc · jump back to</div>
      <div
        role="listbox"
        aria-label="Earlier prompts in this conversation"
        className="max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain"
      >
        {(prompts ?? []).map((item, i) => (
          <button
            key={`${item.at}:${i}`}
            type="button"
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
            className="text-muted-foreground active:bg-muted hover:bg-muted flex min-h-9 w-full items-baseline gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] pointer-coarse:min-h-11 pointer-coarse:py-3"
          >
            <span className="min-w-0 flex-1 truncate">
              {item.text.split("\n")[0]}
            </span>
            <em className="text-muted-foreground/70 shrink-0 text-[10px] not-italic">
              {ago(item.at)}
            </em>
          </button>
        ))}
        {!prompts?.length && (
          <div className="text-muted-foreground px-2.5 py-2 text-xs">
            {isLoading ? "Loading…" : "No earlier prompts yet"}
          </div>
        )}
      </div>
      {/* The mock's choice, shown but not pressable: Claude's restore
          prompt numbers its options differently by what changed, so it's
          answered there */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
        <span className={cn(RESTORE, "bg-foreground text-background")}>
          Conversation
        </span>
        <span className={cn(RESTORE, "bg-muted text-muted-foreground")}>
          Code and conversation
        </span>
        <span className="text-muted-foreground/70 ml-auto text-[10px]">
          Claude asks which
        </span>
      </div>
    </div>
  );
}

/** What a tool call is about, in one line */
function toolSummary(tool: ClaudeTool): string {
  const input = tool.tool_input as Record<string, unknown> | null;
  const pick = (k: string) =>
    input && typeof input[k] === "string" ? (input[k] as string) : null;
  return (
    pick("command") ??
    pick("file_path") ??
    pick("url") ??
    pick("pattern") ??
    pick("description") ??
    ""
  );
}

/**
 * The permission Claude waits on, from its own hook: for when the screen
 * prompt can't be read (the parser's card is preferred, with its answers)
 */
export function PendingPermission({
  tool,
  onOpenTerminal,
}: {
  tool: ClaudeTool;
  onOpenTerminal: () => void;
}) {
  const summary = toolSummary(tool);
  return (
    // Needs-you amber, as the inbox's card: the accent stays for Send
    <div className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-3">
      <ShieldQuestion className="h-5 w-5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Claude wants to use {tool.tool_name}
        </p>
        {summary && (
          <p className="text-muted-foreground truncate font-mono text-xs">
            {summary}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenTerminal}
        className="text-muted-foreground active:bg-accent hover:bg-accent flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
      >
        <SquareTerminal className="h-4 w-4" />
        Answer in terminal
      </button>
    </div>
  );
}
