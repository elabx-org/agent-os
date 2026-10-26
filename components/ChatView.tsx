"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
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
  SquareTerminal,
  Wrench,
  type LucideIcon,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { useQuoteMenu } from "@/components/QuoteMenu";
import { InboxItem } from "@/components/Inbox";
import { useSessionPrompt } from "@/data/prompts/queries";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import {
  isNative,
  isTextKey,
  onNativeEvent,
  postToNative,
} from "@/lib/native-bridge";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { CHAT_KEYS } from "@/components/Terminal/toolbar-config";
import {
  ComposerChips,
  ComposerInput,
  ComposerPopover,
  useComposer,
} from "@/components/Composer";
import {
  ClaudeStateBar,
  PendingPermission,
  QueuedMessages,
  RewindSheet,
  useClaudeLive,
} from "@/components/Composer/ClaudeStateBar";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import { DeckActions } from "@/components/DeckActions";
import { DeckStateLine } from "@/components/DeckStateLine";
import { useSubagents, useWorkflows } from "@/hooks/useSubagents";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
import { AgentRow, KindBadge, StateWord } from "@/components/rows/AgentRow";
import { fromSubagentStatus } from "@/lib/agent-state";
import { agentOpenStore, consumeSubagent } from "@/stores/agentOpen";
import type { Session } from "@/lib/db";
import type { ChatItem } from "@/lib/claude-transcript";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowInfo } from "@/lib/claude-workflows";
import {
  WorkflowCard,
  WorkflowPanel,
  workflowAgentInfo,
} from "@/components/WorkflowPhases";
import {
  AnswerChips,
  DeckContext,
  ReplyContextBar,
  useChatJump,
} from "@/components/ReplyContext";
import { useReplyContext } from "@/hooks/useReplyContext";

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

/**
 * Where the conversation turns the page: the index of the first row on the
 * right page, which the latest rows fill (the last one always goes there).
 * Rows are measured as they render; a row's height on the right page is kept
 * once seen there, so a row at the seam can't bounce between the pages.
 */
function useSeam(
  ids: string[],
  enabled: boolean,
  refs: {
    /** The right page's scroller, its rows, and the left page's rows */
    page: RefObject<HTMLElement | null>;
    rows: RefObject<HTMLElement | null>;
    leftRows: RefObject<HTMLElement | null>;
  }
): number {
  const [seam, setSeam] = useState(0);
  const heights = useRef<{ width: number; byId: Map<string, number> }>({
    width: 0,
    byId: new Map(),
  });
  // The rows each page holds now: the DOM matches the last render
  const rendered = useRef({ ids, seam });
  rendered.current = { ids, seam };
  const { page, rows, leftRows } = refs;

  const measure = useCallback(() => {
    const scroller = page.current;
    const right = rows.current;
    const left = leftRows.current;
    if (!scroller || !right || !left) return;
    const { ids, seam } = rendered.current;
    const cache = heights.current;
    if (cache.width !== right.clientWidth) {
      cache.width = right.clientWidth;
      cache.byId.clear();
    }
    const height = (el: Element) => el.getBoundingClientRect().height;
    Array.from(right.children).forEach((el, i) => {
      const id = ids[seam + i];
      if (id) cache.byId.set(id, height(el));
    });
    const leftHeights = Array.from(left.children).map(height);

    const style = getComputedStyle(scroller);
    const gap = parseFloat(getComputedStyle(right).rowGap) || 0;
    // What else the right page holds below the rows: "Claude is working", a prompt
    const extras =
      (right.parentElement?.offsetHeight ?? 0) - right.offsetHeight;
    const room =
      scroller.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom) -
      extras;

    let next = ids.length;
    let used = 0;
    for (let i = ids.length - 1; i >= 0; i--) {
      const h = cache.byId.get(ids[i]) ?? leftHeights[i] ?? 0;
      const add = next < ids.length ? h + gap : h;
      if (next < ids.length && used + add > room) break;
      used += add;
      next = i;
    }
    setSeam(next);
  }, [page, rows, leftRows]);

  useLayoutEffect(() => {
    if (!enabled) {
      setSeam(0);
      heights.current.byId.clear();
      return;
    }
    measure();
  }, [enabled, ids, seam, measure]);

  // Content that grows (a tool's result, an expanded diff) or a page that
  // changes height (the composer grows) moves the seam
  useEffect(() => {
    if (!enabled) return;
    const ro = new ResizeObserver(measure);
    const content = rows.current?.parentElement;
    for (const el of [page.current, rows.current, content, leftRows.current]) {
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [enabled, measure, page, rows, leftRows]);

  return enabled ? seam : 0;
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
  workflows,
  onShowWorkflow,
}: {
  tools: ToolItem[];
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
  workflows?: Map<string, WorkflowInfo>;
  onShowWorkflow?: (runId: string) => void;
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
        const runId =
          tool.name === "Workflow" ? results.get(tool.id)?.runId : undefined;
        const run = runId ? workflows?.get(runId) : undefined;
        if (run && onOpenAgent && onShowWorkflow)
          return (
            <WorkflowCard
              key={tool.id}
              run={run}
              onOpenAgent={onOpenAgent}
              onShowAll={() => onShowWorkflow(run.runId)}
            />
          );
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
  workflows,
  onShowWorkflow,
  quotable,
}: {
  rows: Row[];
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
  workflows?: Map<string, WorkflowInfo>;
  onShowWorkflow?: (runId: string) => void;
  /** Claude's messages offer "Reply to this" */
  quotable?: boolean;
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
          <Markdown
            key={row.id}
            text={row.text}
            className="break-words"
            quotable={quotable}
            sourceId={row.id}
          />
        ) : (
          <ToolRun
            key={row.id}
            tools={row.tools}
            results={results}
            agents={agents}
            onOpenAgent={onOpenAgent}
            workflows={workflows}
            onShowWorkflow={onShowWorkflow}
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
  /** The activity strip above shows the agents, so the pill row goes */
  hideAgentsBar?: boolean;
  onOpenTerminal: () => void;
  /** Told when the fold deck starts or stops: its state line replaces the strip */
  onDeck?: (on: boolean) => void;
}

/** Claude Code's session as a conversation, read from its transcript */
export function ChatView({
  session,
  active,
  hideAgentsBar,
  onOpenTerminal,
  onDeck,
}: ChatViewProps) {
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
  const runs = useWorkflows(session.id, active);
  const runsById = useMemo(
    () => new Map(runs.map((r) => [r.runId, r] as const)),
    [runs]
  );
  const [openRun, setOpenRun] = useState<string | null>(null);
  useEffect(() => {
    setOpenAgent(null);
    setOpenRun(null);
  }, [session.id]);
  // A subagent row elsewhere (the home) asked for this one's panel
  const { subagent: openRequest } = useSnapshot(agentOpenStore);
  useEffect(() => {
    if (!active || openRequest?.sessionId !== session.id) return;
    const agentId = consumeSubagent(session.id);
    if (agentId) setOpenAgent(agentId);
  }, [active, openRequest, session.id]);
  const opened = useMemo(() => {
    if (!openAgent) return undefined;
    const sub = agents.find((a) => a.agentId === openAgent);
    if (sub) return sub;
    // A workflow's agent opens in the same panel
    for (const run of runs) {
      const agent = run.agents.find((a) => a.agentId === openAgent);
      if (agent) return workflowAgentInfo(run, agent);
    }
  }, [agents, runs, openAgent]);
  const openedRun = openRun ? runsById.get(openRun) : undefined;
  // What takes the right page: an agent, or a whole workflow
  const side = !!opened || !!openedRun;

  // Focus on the open Duo: the conversation reads across both pages like a
  // book, earlier rows on the left page and the latest with the composer on
  // the right. An open subagent takes the right page instead.
  const outerRef = useRef<HTMLDivElement>(null);
  const pages = useSpreadPages(outerRef, useSpreadFold());
  const book = !!pages && !side && state === "ready";
  // Either way each column keeps to one side of the fold
  const paged = book || (!!pages && side);
  const leftRef = useRef<HTMLDivElement>(null);
  const leftRowsRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const leftAtBottom = useRef(true);

  // Follow new output while the reader is at the bottom
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const seam = useSeam(rowIds, book, {
    page: scrollRef,
    rows: rowsRef,
    leftRows: leftRowsRef,
  });
  // "Jump to it" from the reply context: each row is one element, in the
  // left page's list, the right page's or (one column) the conversation's
  const convRef = useRef<HTMLDivElement>(null);
  const findItem = useCallback(
    (itemId: string) => {
      const at = rows.findIndex(
        (r) =>
          r.id === itemId ||
          (r.kind === "tools" && r.tools.some((t) => t.id === itemId))
      );
      if (at < 0) return null;
      const [list, i] = !book
        ? [convRef.current, at]
        : at < seam
          ? [leftRowsRef.current, at]
          : [rowsRef.current, at - seam];
      const el = list?.children[i];
      if (!(el instanceof HTMLElement)) return null;
      // Read where it is, not pulled back down by new output
      atBottom.current = false;
      return el;
    },
    [rows, book, seam]
  );
  useChatJump(session.id, active, findItem);

  // Earlier history goes in above: keep what's on screen where it was
  const shown = useRef<{ first?: string; height: number }>({ height: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // In the book, history goes in at the top of the left page
    const left = book ? leftRef.current : null;
    const top = left ?? el;
    const { first, height } = shown.current;
    const prepended =
      first !== undefined &&
      items[0]?.id !== first &&
      items.some((i) => i.id === first);
    if (prepended) top.scrollTop += top.scrollHeight - height;
    else if (left && leftAtBottom.current) left.scrollTop = left.scrollHeight;
    if (atBottom.current && !(prepended && !left)) {
      el.scrollTop = el.scrollHeight;
    }
    shown.current = { first: items[0]?.id, height: top.scrollHeight };
  }, [items, rows, results, status, book, seam]);

  // The left page stays on its latest rows while they change size
  useEffect(() => {
    const left = leftRef.current;
    const content = leftRowsRef.current;
    if (!book || !left || !content) return;
    const ro = new ResizeObserver(() => {
      if (leftAtBottom.current) left.scrollTop = left.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [book]);

  // Scrolling near the top loads the page above
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topRef.current;
    if (!el || !truncated) return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && loadEarlier(),
      {
        root: book ? leftRef.current : scrollRef.current,
        rootMargin: "400px 0px 0px 0px",
      }
    );
    io.observe(el);
    return () => io.disconnect();
    // Again after each page, in case the top is still in view
  }, [truncated, loadEarlier, state, items.length, book]);

  // Kept on the server: survives a reload, follows to other devices
  const [draft, setDraft] = useSessionDraft(session.id);
  // Pills, pickers, modes and history, shared with the terminal's composer
  const composer = useComposer({
    value: draft,
    onChange: setDraft,
    sessionId: session.id,
    cwd: session.working_directory,
    claude: session.agent_type === "claude",
  });
  const inputRef = composer.textareaRef;
  // Claude's mode, spinner and status line, mirrored under the box
  const live = useClaudeLive({
    sessionId: session.id,
    claude: composer.claude,
    active,
  });
  // Its hook knows of a permission request before the screen poll does. A
  // denied request leaves no hook event behind, so it only counts while the
  // session isn't idle.
  const pending =
    status === "waiting" || status === "running"
      ? live.state.pendingPermission
      : null;
  const needsYou = status === "waiting" || !!pending;
  const { data: prompt, isLoading: promptLoading } = useSessionPrompt(
    session.id,
    { enabled: active && needsYou }
  );
  // Hold (or right-click) a block of Claude's reply to quote it, then type
  const quoteMenu = useQuoteMenu({
    sessionId: session.id,
    onQuoted: () => inputRef.current?.focus(),
  });
  // Return sends, so touch keyboards get a button for a line break
  const insertNewline = () => composer.insert("\n");
  // The iOS app's keyboard bar has a new line, / and @ too, and Paste
  const composerRef = useRef(composer);
  composerRef.current = composer;
  useEffect(
    () =>
      onNativeEvent((event) => {
        if (document.activeElement !== inputRef.current) return;
        if (event.type === "key" && isTextKey(event.key))
          composerRef.current.insert(event.key);
        else if (event.type === "paste")
          composerRef.current.pasteText(event.text);
      }),
    [inputRef]
  );
  // Half open like a laptop or on a table: the conversation stays above the
  // fold, and the composer and the controls sit on the deck below it. The
  // live state joins the work above (the pane drops its strip for it); on a
  // table (not typing) the base holds the actions or the answer first, the
  // composer last.
  const rootRef = useRef<HTMLDivElement>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const deck = useFoldDeck(rootRef);
  const deckControls = deck && !composerFocused && !nativeKeyboard;
  const onDeckFold = !!deck;
  useEffect(() => {
    if (!onDeck) return;
    onDeck(onDeckFold);
    return () => onDeck(false);
  }, [onDeck, onDeckFold]);

  const [sending, setSending] = useState(false);
  const send = useCallback(async () => {
    // The draft, after any quoted passages
    const text = composerRef.current.text.trim();
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
        composerRef.current.sent();
        atBottom.current = true;
      }
    } finally {
      setSending(false);
    }
  }, [draft, session.id]);

  // The answer Claude waits on: the screen's prompt with its options, or
  // what the hook recorded when the screen can't be read
  // A finished turn or a typed-reply wait has nothing to answer here
  const hasCard = !!prompt || (!!pending && !promptLoading);

  // Across both pages without the book (the conversation still loading, or
  // none): the composer on the left page and, while Claude asks, its answers
  // on the right, instead of all of it squeezed right of the fold
  const controlPages = !paged && !deck ? pages : null;
  const ask = useReplyContext(session.id, !!controlPages && active && needsYou);
  const needsYouCard = needsYou && (
    <>
      <ul>
        <InboxItem session={session} onOpen={onOpenTerminal} questionsOnly />
      </ul>
      {pending && !prompt && !promptLoading && (
        <PendingPermission tool={pending} onOpenTerminal={onOpenTerminal} />
      )}
    </>
  );

  const earlier = state === "ready" && truncated && (
    <div ref={topRef} className="flex justify-center py-1">
      <button
        type="button"
        onClick={loadEarlier}
        disabled={loadingEarlier}
        className="text-muted-foreground active:bg-accent hover:bg-accent flex h-9 items-center gap-2 rounded-full px-4 text-xs"
      >
        {loadingEarlier && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {loadingEarlier ? "Loading earlier messages…" : "Earlier messages"}
      </button>
    </div>
  );
  const gutter = pages && pages.gutter > 0 && (
    <div
      aria-hidden="true"
      className="bg-background shrink-0"
      style={{ width: pages.gutter }}
    />
  );

  return (
    <div ref={outerRef} className="@container/chat relative flex h-full">
      {/* The book's left page: earlier rows, down to where the right one
          picks up */}
      {book && pages && (
        <>
          <div
            ref={leftRef}
            {...quoteMenu.handlers}
            onScroll={(e) => {
              const el = e.currentTarget;
              leftAtBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
            className="bg-background min-h-0 shrink-0 overflow-y-auto px-3 pt-3 pb-[calc(0.75rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]"
            style={{ width: pages.left }}
          >
            <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-3">
              {earlier}
              <div ref={leftRowsRef} className="flex flex-col gap-3">
                <Conversation
                  rows={rows.slice(0, seam)}
                  results={results}
                  agents={agentsByTool}
                  onOpenAgent={setOpenAgent}
                  workflows={runsById}
                  onShowWorkflow={setOpenRun}
                  quotable
                />
              </div>
            </div>
          </div>
          {gutter}
        </>
      )}
      <div
        ref={rootRef}
        className={cn(
          "bg-background flex h-full min-w-0 flex-col",
          pages && side ? "shrink-0" : "flex-1"
        )}
        style={pages && side ? { width: pages.left } : undefined}
      >
        {agents.length > 0 && !hideAgentsBar && (
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
        {deck && <DeckStateLine session={session} active={active} />}
        <div
          ref={scrollRef}
          {...quoteMenu.handlers}
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
            {!book && earlier}
            {book ? (
              <div ref={rowsRef} className="flex flex-col gap-3">
                <Conversation
                  rows={rows.slice(seam)}
                  results={results}
                  agents={agentsByTool}
                  onOpenAgent={setOpenAgent}
                  workflows={runsById}
                  onShowWorkflow={setOpenRun}
                  quotable
                />
              </div>
            ) : (
              <div ref={convRef} className="contents">
                <Conversation
                  rows={rows}
                  results={results}
                  agents={agentsByTool}
                  onOpenAgent={setOpenAgent}
                  workflows={runsById}
                  onShowWorkflow={setOpenRun}
                  quotable
                />
              </div>
            )}
            {/* The state line above says so on a table */}
            {status === "running" && !deckControls && (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
                Claude is working
              </div>
            )}
            {!deckControls && needsYouCard}
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
            "px-2.5 pt-1.5 pb-[calc(0.625rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]",
            // As pages, it already sits on one side of the fold
            !paged && !controlPages && "fold-controls",
            deck && "flex flex-col",
            controlPages && "flex items-end"
          )}
          style={{ height: deck?.deck }}
        >
          {/* On the base, nearest the work above: the answer Claude is
          waiting for, or Stop / Changes / Terminal. The composer comes last,
          within the thumbs' reach. */}
          {deckControls && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pt-1.5 pb-3">
              {needsYou && hasCard ? (
                needsYouCard
              ) : (
                <DeckActions
                  sessionId={session.id}
                  status={status}
                  view="chat"
                  onView={(mode) =>
                    mode === "terminal"
                      ? onOpenTerminal()
                      : mobileNavActions.requestViewMode(mode, session.id)
                  }
                />
              )}
            </div>
          )}
          <div
            className="relative shrink-0"
            // Less the container's padding, so it ends where the page does
            style={controlPages ? { width: controlPages.left - 10 } : undefined}
          >
            <ComposerPopover composer={composer} />
            <RewindSheet
              live={live}
              cwd={composer.cwd}
              onRewound={onOpenTerminal}
            />
            <QueuedMessages live={live} />
            {/* What's being answered, and the passages quoted to answer */}
            <ReplyContextBar
              composer={composer}
              sessionId={session.id}
              view="chat"
              bounds={rootRef}
            />
            <ComposerChips composer={composer} historyChip />
            <div
              className={cn(
                // Glass-like capsule, as the control column
                "bg-background/70 border-border flex shrink-0 gap-1.5 rounded-[28px] border p-1.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08)] backdrop-blur-xl backdrop-saturate-150",
                deck && !deckControls ? "items-start" : "items-end"
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
              <ComposerInput
                composer={composer}
                onFocus={() => {
                  setComposerFocused(true);
                  // The app's keyboard bar shows no terminal keys in chat
                  if (isNative())
                    postToNative({
                      type: "keys",
                      context: "chat",
                      ids: CHAT_KEYS,
                    });
                }}
                onBlur={() => setComposerFocused(false)}
                onKeyDown={(e) => {
                  if (live.onKeyDown(e)) return;
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
                placeholder="Message Claude"
                className="flex-1"
                inputClassName="max-h-40"
                autoGrow
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
            <ClaudeStateBar live={live} />
          </div>
          {controlPages && (
            <>
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ width: controlPages.gutter }}
              />
              <div className="flex min-w-0 flex-1 items-center gap-2 pb-1.5">
                {!!ask?.options.length && (
                  <>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      Claude asks
                    </span>
                    <AnswerChips
                      context={ask}
                      sessionId={session.id}
                      className="min-w-0"
                    />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {side && pages && gutter}
      {openedRun && !opened && (
        <WorkflowPanel
          key={openedRun.runId}
          run={openedRun}
          onOpenAgent={setOpenAgent}
          onClose={() => setOpenRun(null)}
          className={
            pages
              ? "@2xl/chat:w-auto @2xl/chat:max-w-none @2xl/chat:flex-1 @2xl/chat:border-l-0"
              : undefined
          }
        />
      )}
      {opened && (
        <SubagentPanel
          key={opened.agentId}
          sessionId={session.id}
          agent={opened}
          onClose={() => setOpenAgent(null)}
          // The right page, with the conversation on the left
          className={
            pages
              ? "@2xl/chat:w-auto @2xl/chat:max-w-none @2xl/chat:flex-1 @2xl/chat:border-l-0"
              : undefined
          }
        />
      )}
      {/* On a table while typing: Claude's last turn over the chat above */}
      <DeckContext
        sessionId={session.id}
        view="chat"
        on={!!deck && active}
        cover={scrollRef}
      />
      {quoteMenu.menu}
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
  className,
}: {
  sessionId: string;
  agent: SubagentInfo;
  onClose: () => void;
  className?: string;
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
      className={cn(
        "bg-background border-border absolute inset-0 z-10 flex flex-col @2xl/chat:static @2xl/chat:w-[46%] @2xl/chat:max-w-xl @2xl/chat:shrink-0 @2xl/chat:border-l",
        className
      )}
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
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(0.75rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]"
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
