"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Square,
  SquareTerminal,
  Wrench,
  type LucideIcon,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { InboxItem } from "@/components/Inbox";
import { mobileNavStore } from "@/stores/mobileNav";
import {
  isNative,
  isTextKey,
  onNativeEvent,
  postToNative,
} from "@/lib/native-bridge";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import { useSubagents } from "@/hooks/useSubagents";
import { AgentRow, KindBadge, StateWord } from "@/components/rows/AgentRow";
import { fromSubagentStatus } from "@/lib/agent-state";
import { agentOpenStore, consumeSubagent } from "@/stores/agentOpen";
import type { Session } from "@/lib/db";
import type { ChatItem } from "@/lib/claude-transcript";
import type { SubagentInfo } from "@/lib/claude-subagents";

const POLL_MS = 1500;
/** Runs of tool calls longer than this collapse to their last few */
const TOOL_RUN_VISIBLE = 3;

type ToolItem = Extract<ChatItem, { kind: "tool" }>;
type ResultItem = Extract<ChatItem, { kind: "result" }>;
type Row =
  | Extract<ChatItem, { kind: "user" | "assistant" | "summary" }>
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
  start?: number;
  truncated?: boolean;
  reset?: boolean;
  notFound?: boolean;
  unsupported?: boolean;
}

/** `base` is the session's API path, or one of its subagents' */
function useTranscript(base: string, active: boolean) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    "loading"
  );
  const [truncated, setTruncated] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const busy = useRef(false);
  const cursor = useRef<{ offset?: number; sid?: string; start?: number }>({});

  useEffect(() => {
    cursor.current = {};
    setItems([]);
    setState("loading");
  }, [base]);

  // The page of history above what's shown
  const loadEarlier = useCallback(async () => {
    const { start, sid } = cursor.current;
    if (start === undefined || start <= 0 || busy.current) return;
    busy.current = true;
    setLoadingEarlier(true);
    try {
      const res = await fetch(
        `${base}/transcript?before=${start}&sid=${sid ?? ""}`
      );
      const data: TranscriptResponse = await res.json();
      // A different Claude session now: the poll will start over
      if (!data.items || data.reset || cursor.current.start !== start) return;
      cursor.current.start = data.start;
      setItems((prev) => [...data.items!, ...prev]);
      setTruncated(!!data.truncated);
    } catch {
      // Try again on the next scroll up
    } finally {
      busy.current = false;
      setLoadingEarlier(false);
    }
  }, [base]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const { offset, sid } = cursor.current;
      const qs =
        offset === undefined ? "" : `?since=${offset}&sid=${sid ?? ""}`;
      try {
        const res = await fetch(`${base}/transcript${qs}`);
        const data: TranscriptResponse = await res.json();
        if (stopped) return;
        if (data.notFound || data.unsupported || !data.items) {
          setState("missing");
        } else {
          const fresh = offset === undefined || data.reset;
          cursor.current = {
            ...cursor.current,
            offset: data.offset,
            sid: data.sessionId,
          };
          if (fresh) {
            cursor.current.start = data.start;
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
  }, [base, active]);

  return { items, state, truncated, loadEarlier, loadingEarlier };
}

function useRows(items: ChatItem[]) {
  return useMemo(() => {
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

/** A subagent the session started: what it's doing, and a way into it */
function SubagentRow({
  agent,
  onOpen,
}: {
  agent: SubagentInfo;
  onOpen: (agentId: string) => void;
}) {
  const state = fromSubagentStatus(agent.status);
  return (
    <AgentRow
      kind="subagent"
      state={state}
      title={agent.description}
      subtitle={
        <>
          <StateWord state={state} />
          {[
            agent.agentType,
            agent.steps !== null
              ? `${agent.steps} ${agent.steps === 1 ? "step" : "steps"}`
              : null,
          ]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join("")}
        </>
      }
      trailing={
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground h-4 w-4"
        />
      }
      onClick={() => onOpen(agent.agentId)}
      className="bg-card ring-border ring-1 ring-inset"
    />
  );
}

function ToolRun({
  tools,
  results,
  agents,
  onOpenAgent,
}: {
  tools: ToolItem[];
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
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
      {tools.slice(hidden).map((tool) => {
        const agent = agents?.get(tool.id);
        return agent && onOpenAgent ? (
          <SubagentRow key={tool.id} agent={agent} onOpen={onOpenAgent} />
        ) : (
          <ToolRow key={tool.id} tool={tool} result={results.get(tool.id)} />
        );
      })}
    </div>
  );
}

/** The conversation's messages and tool calls, as rows */
function Conversation({
  rows,
  results,
  agents,
  onOpenAgent,
}: {
  rows: Row[];
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
}) {
  return (
    <>
      {rows.map((row) =>
        row.kind === "user" ? (
          <div
            key={row.id}
            className="bg-accent ml-8 max-w-full min-w-0 self-end rounded-2xl rounded-br-md px-3.5 py-2 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
          >
            {row.text}
          </div>
        ) : row.kind === "summary" ? (
          <details key={row.id} className="group text-xs">
            <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="bg-border h-px flex-1" />
              <span className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                Earlier conversation summarised
              </span>
              <span className="bg-border h-px flex-1" />
            </summary>
            <div className="bg-secondary/40 mt-1 max-h-[60vh] overflow-y-auto rounded-xl p-3">
              <Markdown text={row.text} className="text-xs break-words" />
            </div>
          </details>
        ) : row.kind === "assistant" ? (
          <Markdown key={row.id} text={row.text} className="break-words" />
        ) : (
          <ToolRun
            key={row.id}
            tools={row.tools}
            results={results}
            agents={agents}
            onOpenAgent={onOpenAgent}
          />
        )
      )}
    </>
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
  const { items, state, truncated, loadEarlier, loadingEarlier } =
    useTranscript(`/api/sessions/${session.id}`, active);
  const { statuses, nativeKeyboard } = useSnapshot(mobileNavStore);
  const status = statuses[session.id]?.status;
  const { rows, results } = useRows(items);

  const agents = useSubagents(session.id, active);
  const agentsByTool = useMemo(
    () =>
      new Map(
        agents.flatMap((a) => (a.toolUseId ? [[a.toolUseId, a] as const] : []))
      ),
    [agents]
  );
  const running = agents.filter((a) => a.status === "running");
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [agentList, setAgentList] = useState(false);
  useEffect(() => setOpenAgent(null), [session.id]);
  // A subagent row elsewhere (the home) asked for this one's panel
  const { subagent: openRequest } = useSnapshot(agentOpenStore);
  useEffect(() => {
    if (!active || openRequest?.sessionId !== session.id) return;
    const agentId = consumeSubagent(session.id);
    if (agentId) setOpenAgent(agentId);
  }, [active, openRequest, session.id]);
  const opened = agents.find((a) => a.agentId === openAgent);

  // Follow new output while the reader is at the bottom
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  // Earlier history goes in above: keep what's on screen where it was
  const shown = useRef<{ first?: string; height: number }>({ height: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { first, height } = shown.current;
    const prepended =
      first !== undefined &&
      items[0]?.id !== first &&
      items.some((i) => i.id === first);
    if (prepended) el.scrollTop += el.scrollHeight - height;
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
    shown.current = { first: items[0]?.id, height: el.scrollHeight };
  }, [items, rows, results, status]);

  // Scrolling near the top loads the page above
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topRef.current;
    if (!el || !truncated) return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && loadEarlier(),
      { root: scrollRef.current, rootMargin: "400px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // Again after each page, in case the top is still in view
  }, [truncated, loadEarlier, state, items.length]);

  // Kept on the server: survives a reload, follows to other devices
  const [draft, setDraft] = useSessionDraft(session.id);
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
  // Half open like a laptop or on a table: the conversation stays above the
  // fold, and the composer and the controls sit on the deck below it
  const rootRef = useRef<HTMLDivElement>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const deck = useFoldDeck(rootRef);
  const deckControls = deck && !composerFocused && !nativeKeyboard;

  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    try {
      await fetch(`/api/sessions/${session.id}/interrupt`, { method: "POST" });
    } finally {
      setStopping(false);
    }
  };

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
    <div className="relative flex h-full">
      <div
        ref={rootRef}
        className="bg-background flex h-full min-w-0 flex-1 flex-col"
      >
        {agents.length > 0 && (
          <div className="border-border shrink-0 border-b px-3 py-1.5">
            <button
              type="button"
              onClick={() => setAgentList((v) => !v)}
              aria-expanded={agentList}
              className="text-muted-foreground active:bg-accent hover:bg-accent flex h-9 items-center gap-2 rounded-full px-3 text-xs"
            >
              {running.length > 0 ? (
                <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bot className="h-3.5 w-3.5" />
              )}
              {running.length > 0
                ? `${running.length} ${running.length === 1 ? "agent" : "agents"} working`
                : `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`}
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  agentList && "rotate-90"
                )}
              />
            </button>
            {agentList && (
              <div className="mx-auto flex max-h-[40vh] max-w-3xl flex-col gap-1.5 overflow-y-auto pt-1.5 pb-1">
                {[
                  ...running,
                  ...agents.filter((a) => a.status !== "running").reverse(),
                ].map((agent) => (
                  <SubagentRow
                    key={agent.agentId}
                    agent={agent}
                    onOpen={(id) => {
                      setOpenAgent(id);
                      setAgentList(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
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
              <div ref={topRef} className="flex justify-center py-1">
                <button
                  type="button"
                  onClick={loadEarlier}
                  disabled={loadingEarlier}
                  className="text-muted-foreground active:bg-accent hover:bg-accent flex h-9 items-center gap-2 rounded-full px-4 text-xs"
                >
                  {loadingEarlier && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {loadingEarlier
                    ? "Loading earlier messages…"
                    : "Earlier messages"}
                </button>
              </div>
            )}
            <Conversation
              rows={rows}
              results={results}
              agents={agentsByTool}
              onOpenAgent={setOpenAgent}
            />
            {status === "running" && (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
                Claude is working
              </div>
            )}
            {status === "waiting" && !deckControls && (
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
            "border-border border-t px-2 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]",
            deck && "flex flex-col"
          )}
          style={{ height: deck?.deck }}
        >
          <div
            className={cn(
              "flex shrink-0 gap-1.5",
              deck ? "items-start" : "items-end"
            )}
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
              onFocus={() => {
                setComposerFocused(true);
                // The app's keyboard bar shows no terminal keys in chat
                if (isNative()) postToNative({ type: "keys", context: "chat" });
              }}
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
          {/* On the deck, within the thumbs' reach: the answer Claude is
          waiting for, or Stop while it works */}
          {deckControls && (
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-2 pt-3">
              {status === "waiting" && (
                <ul>
                  <InboxItem
                    session={session}
                    onOpen={onOpenTerminal}
                    questionsOnly
                  />
                </ul>
              )}
              {status === "running" && (
                <button
                  type="button"
                  onClick={stop}
                  disabled={stopping}
                  className="flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 text-sm font-semibold text-red-400 active:opacity-70"
                >
                  {stopping ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4 fill-current" />
                  )}
                  Stop Claude
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {opened && (
        <SubagentPanel
          key={opened.agentId}
          sessionId={session.id}
          agent={opened}
          onClose={() => setOpenAgent(null)}
        />
      )}
    </div>
  );
}

/**
 * One subagent's own conversation: over the chat on a phone, beside it when
 * there's room (an iPhone Duo opened flat, a desktop)
 */
function SubagentPanel({
  sessionId,
  agent,
  onClose,
}: {
  sessionId: string;
  agent: SubagentInfo;
  onClose: () => void;
}) {
  const { items, state, truncated, loadEarlier, loadingEarlier } =
    useTranscript(
      `/api/sessions/${sessionId}/subagents/${agent.agentId}`,
      true
    );
  const { rows, results } = useRows(items);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <section
      aria-label={agent.description}
      className="bg-background border-border absolute inset-0 z-10 flex flex-col md:static md:w-[46%] md:max-w-xl md:shrink-0 md:border-l"
    >
      <header className="border-border flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="text-primary active:bg-accent hover:bg-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {agent.description}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            <StateWord state={fromSubagentStatus(agent.status)} /> ·{" "}
            {agent.agentType || "Agent"}
          </div>
        </div>
        <KindBadge kind="subagent" state={fromSubagentStatus(agent.status)} />
        <span className="w-2" />
      </header>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {state === "loading" && (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {state === "missing" && (
            <div className="text-muted-foreground py-8 text-sm">
              This agent&apos;s conversation isn&apos;t available.
            </div>
          )}
          {state === "ready" && truncated && (
            <div className="flex justify-center py-1">
              <button
                type="button"
                onClick={loadEarlier}
                disabled={loadingEarlier}
                className="text-muted-foreground active:bg-accent hover:bg-accent flex h-9 items-center gap-2 rounded-full px-4 text-xs"
              >
                {loadingEarlier && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Earlier messages
              </button>
            </div>
          )}
          <Conversation rows={rows} results={results} />
          {agent.status === "running" && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
              Working
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
