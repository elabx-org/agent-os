"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import {
  ArrowUp,
  Bot,
  CornerDownLeft,
  FilePlus,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/components/ChatMessage";
import { InboxItem } from "@/components/Inbox";
import { mobileNavStore } from "@/stores/mobileNav";
import { isTextKey, onNativeEvent } from "@/lib/native-bridge";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import type { Session } from "@/lib/db";
import type { ChatItem } from "@/lib/claude-transcript";

const POLL_MS = 1500;
/** Runs of tool calls longer than this collapse to their last few */
const TOOL_RUN_VISIBLE = 3;

type ToolItem = Extract<ChatItem, { kind: "tool" }>;
type ResultItem = Extract<ChatItem, { kind: "result" }>;
type Row =
  | Extract<ChatItem, { kind: "user" | "assistant" }>
  | { kind: "tools"; id: string; tools: ToolItem[] };

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: SquareTerminal,
  Edit: Pencil,
  MultiEdit: Pencil,
  NotebookEdit: Pencil,
  Write: FilePlus,
  Read: FileText,
  Grep: Search,
  Glob: Search,
  Agent: Bot,
  Task: Bot,
  WebFetch: Globe,
  WebSearch: Globe,
};

interface TranscriptResponse {
  sessionId?: string;
  items?: ChatItem[];
  offset?: number;
  truncated?: boolean;
  reset?: boolean;
  notFound?: boolean;
  unsupported?: boolean;
}

function useTranscript(sessionId: string, active: boolean) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    "loading"
  );
  const [truncated, setTruncated] = useState(false);
  const cursor = useRef<{ offset?: number; sid?: string }>({});

  useEffect(() => {
    cursor.current = {};
    setItems([]);
    setState("loading");
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const { offset, sid } = cursor.current;
      const qs =
        offset === undefined ? "" : `?since=${offset}&sid=${sid ?? ""}`;
      try {
        const res = await fetch(`/api/sessions/${sessionId}/transcript${qs}`);
        const data: TranscriptResponse = await res.json();
        if (stopped) return;
        if (data.notFound || data.unsupported || !data.items) {
          setState("missing");
        } else {
          const fresh = offset === undefined || data.reset;
          cursor.current = { offset: data.offset, sid: data.sessionId };
          if (fresh) {
            setItems(data.items);
            setTruncated(!!data.truncated);
          } else if (data.items.length) {
            setItems((prev) => [...prev, ...data.items!]);
          }
          setState("ready");
        }
      } catch {
        // Keep what we have; try again next tick
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId, active]);

  return { items, state, truncated };
}

/** Lines shown before "Show all": the first change with a line of context */
const PATCH_PEEK = 5;

function Patch({ lines, all }: { lines: string[]; all: boolean }) {
  const first = Math.max(
    0,
    lines.findIndex((l) => l[0] === "+" || l[0] === "-") - 1
  );
  const shown = all ? lines : lines.slice(first, first + PATCH_PEEK);
  return (
    <div className="border-border overflow-x-auto border-t py-1.5 font-mono text-[11.5px] leading-relaxed">
      {shown.map((line, i) =>
        line === "@" ? (
          <div key={i} className="text-muted-foreground px-3">
            ⋯
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              "flex gap-2 px-3",
              line[0] === "+" &&
                "bg-blue-400/12 text-blue-700 dark:text-blue-200",
              line[0] === "-" &&
                "bg-amber-400/10 text-amber-700 dark:text-amber-200",
              line[0] !== "+" && line[0] !== "-" && "text-muted-foreground"
            )}
          >
            <span aria-hidden="true" className="w-2 shrink-0 select-none">
              {line[0] === "-" ? "−" : line[0] === "+" ? "+" : ""}
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
              {line.slice(1) || " "}
            </span>
          </div>
        )
      )}
    </div>
  );
}

function ToolRow({ tool, result }: { tool: ToolItem; result?: ResultItem }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[tool.name] ?? Wrench;
  const hasDiff = result?.added !== undefined;
  const patch = result && !result.isError ? result.patch : undefined;
  const expandable = !!(patch ? patch.length > PATCH_PEEK : result?.preview);

  return (
    <div className="bg-card border-border overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className="flex min-h-[40px] w-full items-center gap-2.5 px-3 py-2 text-left"
        aria-expanded={expandable ? open : undefined}
      >
        <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="text-muted-foreground shrink-0 text-xs">
          {tool.name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {tool.summary}
        </span>
        {!result && (
          <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
        )}
        {result?.isError && (
          <span className="shrink-0 text-xs font-medium text-red-400">
            Failed
          </span>
        )}
        {result && !result.isError && hasDiff && (
          <span className="shrink-0 font-mono text-xs">
            <span className="text-blue-400">+{result.added}</span>{" "}
            <span className="text-amber-400">−{result.removed}</span>
          </span>
        )}
      </button>
      {patch && <Patch lines={patch} all={open} />}
      {patch && expandable && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-muted-foreground hover:text-foreground border-border w-full border-t px-3 py-2 text-left text-xs"
        >
          {open ? "Show less" : `Show all ${patch.length} lines`}
        </button>
      )}
      {!patch && open && result?.preview && (
        <pre className="border-border text-muted-foreground max-h-56 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {result.preview}
        </pre>
      )}
    </div>
  );
}

function ToolRun({
  tools,
  results,
}: {
  tools: ToolItem[];
  results: Map<string, ResultItem>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : Math.max(0, tools.length - TOOL_RUN_VISIBLE);
  return (
    <div className="space-y-1.5">
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground hover:text-foreground px-1 text-xs"
        >
          {hidden} earlier {hidden === 1 ? "step" : "steps"}
        </button>
      )}
      {tools.slice(hidden).map((tool) => (
        <ToolRow key={tool.id} tool={tool} result={results.get(tool.id)} />
      ))}
    </div>
  );
}

interface ChatViewProps {
  session: Session;
  /** Only poll while the view is showing */
  active: boolean;
  onOpenTerminal: () => void;
}

/** Claude Code's session as a conversation, read from its transcript */
export function ChatView({ session, active, onOpenTerminal }: ChatViewProps) {
  const { items, state, truncated } = useTranscript(session.id, active);
  const { statuses, nativeKeyboard } = useSnapshot(mobileNavStore);
  const status = statuses[session.id]?.status;

  const { rows, results } = useMemo(() => {
    const results = new Map<string, ResultItem>();
    const rows: Row[] = [];
    for (const item of items) {
      if (item.kind === "result") {
        results.set(item.toolUseId, item);
      } else if (item.kind === "tool") {
        const last = rows[rows.length - 1];
        if (last?.kind === "tools") last.tools.push(item);
        else rows.push({ kind: "tools", id: item.id, tools: [item] });
      } else {
        rows.push(item);
      }
    }
    return { rows, results };
  }, [items]);

  // Follow new output while the reader is at the bottom
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [rows, results, status]);

  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Return sends, so touch keyboards get a button for a line break
  const insertText = (text: string) => {
    const el = inputRef.current;
    if (!el) return;
    const { selectionStart: from, selectionEnd: to } = el;
    setDraft((d) => d.slice(0, from) + text + d.slice(to));
    const at = from + text.length;
    requestAnimationFrame(() => el.setSelectionRange(at, at));
  };
  const insertNewline = () => insertText("\n");
  // The iOS app's keyboard bar has a new line, / and @ too, and Paste
  useEffect(
    () =>
      onNativeEvent((event) => {
        if (document.activeElement !== inputRef.current) return;
        if (event.type === "key" && isTextKey(event.key)) insertText(event.key);
        else if (event.type === "paste") insertText(event.text);
      }),
    // insertText only reads the ref and the setter
    []
  );
  // Half open like a laptop: while typing, the conversation stays above the
  // fold and the composer sits on the deck below it
  const rootRef = useRef<HTMLDivElement>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const deck = useFoldDeck(rootRef, 0, composerFocused || nativeKeyboard);

  const [sending, setSending] = useState(false);
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/send-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, pressEnter: true }),
      });
      if (res.ok) {
        setDraft("");
        atBottom.current = true;
      }
    } finally {
      setSending(false);
    }
  }, [draft, session.id]);

  return (
    <div ref={rootRef} className="bg-background flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {state === "loading" && (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the
              conversation…
            </div>
          )}
          {state === "missing" && (
            <div className="text-muted-foreground py-8 text-sm">
              No Claude Code conversation found for this session.{" "}
              <button
                type="button"
                onClick={onOpenTerminal}
                className="text-primary underline-offset-2 hover:underline"
              >
                Open the terminal
              </button>
            </div>
          )}
          {state === "ready" && truncated && (
            <p className="text-muted-foreground text-center text-xs">
              Showing recent messages
            </p>
          )}
          {rows.map((row) =>
            row.kind === "user" ? (
              <div
                key={row.id}
                className="bg-accent ml-8 self-end rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap"
              >
                {row.text}
              </div>
            ) : row.kind === "assistant" ? (
              <div
                key={row.id}
                className="text-sm leading-relaxed break-words whitespace-pre-wrap"
              >
                {renderMarkdown(row.text)}
              </div>
            ) : (
              <ToolRun key={row.id} tools={row.tools} results={results} />
            )
          )}
          {status === "running" && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
              Claude is working
            </div>
          )}
          {status === "waiting" && (
            <ul>
              <InboxItem
                session={session}
                onOpen={onOpenTerminal}
                questionsOnly
              />
            </ul>
          )}
        </div>
      </div>

      {deck && (
        <div
          aria-hidden="true"
          className="shrink-0"
          style={{ height: deck.gap }}
        />
      )}
      <div
        className={cn(
          "border-border flex gap-1.5 border-t px-2 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]",
          deck ? "items-start" : "items-end"
        )}
        style={{ height: deck?.deck }}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertNewline}
          aria-label="New line"
          title="New line"
          className="bg-secondary text-muted-foreground active:bg-accent flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-full [@media(pointer:fine)]:hidden"
        >
          <CornerDownLeft className="h-5 w-5" />
        </button>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setComposerFocused(true)}
          onBlur={() => setComposerFocused(false)}
          onKeyDown={(e) => {
            // Return sends, Shift+Return adds a line
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send();
            }
          }}
          enterKeyHint="send"
          rows={1}
          placeholder="Message Claude"
          className="bg-secondary text-foreground placeholder:text-muted-foreground max-h-40 min-h-[44px] flex-1 resize-none rounded-2xl px-3.5 py-2.5 text-base leading-6 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className={cn(
            "flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-full",
            draft.trim()
              ? "bg-primary text-primary-foreground active:opacity-80"
              : "bg-secondary text-muted-foreground"
          )}
        >
          {sending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowUp className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
