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
import { Bot, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuoteMenu } from "@/components/QuoteMenu";
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
  ComposerPopover,
  useComposer,
} from "@/components/Composer";
import { ComposerCard } from "@/components/Composer/ComposerCard";
import {
  ClaudeStateBar,
  RewindSheet,
  useClaudeLive,
} from "@/components/Composer/ClaudeStateBar";
import { StopPill } from "@/components/Session/StopPill";
import { StateDot } from "@/components/a/StateDot";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useQueue } from "@/hooks/useQueue";
import { useTurns } from "@/hooks/useTurns";
import { useSessionPrompt } from "@/data/prompts/queries";
import { DeckActions } from "@/components/DeckActions";
import { DeckStateLine } from "@/components/DeckStateLine";
import { useSubagents, useWorkflows } from "@/hooks/useSubagents";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
import { agentOpenStore, consumeSubagent } from "@/stores/agentOpen";
import type { Session } from "@/lib/db";
import { WorkflowPanel, workflowAgentInfo } from "@/components/WorkflowPhases";
import {
  AnswerChips,
  DeckContext,
  ReplyContextBar,
  useChatJump,
} from "@/components/ReplyContext";
import { useReplyContext } from "@/hooks/useReplyContext";
import { fetchAsUser } from "@/lib/client/user-fetch";
import { Conversation, type TurnActions } from "./Conversation";
import { LimitedCardSlot } from "./LimitedCardSlot";
import { NeedsYouCard } from "./NeedsYouCard";
import { buildRows, placeTurns } from "./rows";
import { SubagentPanel } from "./SubagentPanel";
import { SubagentRow } from "./ToolCard";
import { TurnDiff } from "./TurnDiff";
import { UndoSheet } from "./UndoSheet";
import { useSeam } from "./useSeam";
import { useTranscript } from "./useTranscript";

export interface ChatViewProps {
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
  const { rows, results } = useMemo(() => buildRows(items), [items]);

  // Each turn's card after the reply that ended it (flag `snapshots`)
  const turns = useTurns(session.id, { enabled: active });
  const [diffTurn, setDiffTurn] = useState<number | null>(null);
  const [undoTurn, setUndoTurn] = useState<number | null>(null);
  const turnActions = useMemo<TurnActions | undefined>(
    () =>
      turns.enabled && turns.turns.length
        ? {
            after: placeTurns(rows, turns.turns),
            onDiff: setDiffTurn,
            onUndo: setUndoTurn,
          }
        : undefined,
    [turns.enabled, turns.turns, rows]
  );
  useEffect(() => {
    setDiffTurn(null);
    setUndoTurn(null);
  }, [session.id]);

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

  // The server queue decides whether a message goes in now or waits
  // (ComposerCard sends through it); with the flag off, the old direct send
  const queue = useQueue(session.id, { enabled: active });
  // The card clears the draft once a send went; this only follows it down
  const sent = useCallback(() => {
    atBottom.current = true;
  }, []);
  const sendDirect = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const res = await fetchAsUser(`/api/sessions/${session.id}/send-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), pressEnter: true }),
      });
      if (!res.ok) throw new Error("Couldn't send to Claude");
      sent();
    },
    [session.id, sent]
  );
  const mode = useLayoutMode();

  // The answer Claude waits on: the screen's prompt with its options, or
  // what the hook recorded when the screen can't be read
  // A finished turn or a typed-reply wait has nothing to answer here
  const hasCard = !!prompt || (!!pending && !promptLoading);

  // Across both pages: the composer on the left page and, while Claude
  // asks, its answers on the right, instead of all of it squeezed right of
  // the fold. In the book they run under both pages (the left page's rows
  // end above them); not with a subagent on the right page
  const controlPages = (book || !paged) && !deck ? pages : null;
  const controlsRef = useRef<HTMLDivElement>(null);
  const [controlsHeight, setControlsHeight] = useState(0);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el || !book) return;
    const ro = new ResizeObserver(() => setControlsHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [book]);
  const ask = useReplyContext(session.id, !!controlPages && active && needsYou);
  const needsYouCard = (
    <>
      {needsYou && (
        <NeedsYouCard
          session={session}
          variant="inline"
          onOpenTerminal={onOpenTerminal}
        />
      )}
      <LimitedCardSlot session={session} />
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
            className={cn(
              "bg-background min-h-0 shrink-0 overflow-y-auto px-3 pt-3",
              !controlPages &&
                "pb-[calc(0.75rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]"
            )}
            // The composer runs under this page too
            style={{
              width: pages.left,
              paddingBottom: controlPages ? controlsHeight + 12 : undefined,
            }}
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
                  turns={turnActions}
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
                  turns={turnActions}
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
                  turns={turnActions}
                />
              </div>
            )}
            {/* The state line above says so on a table */}
            {status === "running" && !deckControls && (
              <div className="text-muted-foreground flex items-center gap-2 px-1 text-[13px]">
                <StateDot state="work" className="animate-pulse" />
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
          ref={controlsRef}
          className={cn(
            "px-2.5 pt-1.5 pb-[calc(0.625rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]",
            // As pages, it already sits on one side of the fold
            !paged && !controlPages && "fold-controls",
            deck && "flex flex-col",
            controlPages && "flex items-end",
            book && controlPages && "bg-background relative"
          )}
          style={{
            height: deck?.deck,
            // The book's right page holds it: reach back under the left page
            marginLeft:
              book && controlPages
                ? -(controlPages.left + controlPages.gutter)
                : undefined,
          }}
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
            <ComposerCard
              composer={composer}
              sessionId={session.id}
              agentName="Claude"
              queue={queue}
              onSendDirect={sendDirect}
              onSent={sent}
              placeholder={
                mode === "desktop"
                  ? "Reply to Claude, / for commands, @ for files"
                  : "Reply to Claude"
              }
              inputProps={{
                onFocus: () => {
                  setComposerFocused(true);
                  // The app's keyboard bar shows no terminal keys in chat
                  if (isNative())
                    postToNative({
                      type: "keys",
                      context: "chat",
                      ids: CHAT_KEYS,
                    });
                },
                onBlur: () => setComposerFocused(false),
                // Shift+Tab and Esc go to Claude; the card sends on Return
                onKeyDown: (e) => {
                  live.onKeyDown(e);
                },
                enterKeyHint: "send",
                inputClassName: "max-h-40",
                autoGrow: true,
              }}
              // Half folded, Stop sits beside the composer (Fold-Chat)
              trailing={deck ? <StopPill session={session} /> : undefined}
              above={
                <>
                  {/* What's being answered, and the passages quoted to answer */}
                  <ReplyContextBar
                    composer={composer}
                    sessionId={session.id}
                    view="chat"
                    bounds={rootRef}
                  />
                  <ComposerChips composer={composer} historyChip />
                </>
              }
            />
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
      {diffTurn !== null && (
        <TurnDiff
          sessionId={session.id}
          turnNo={diffTurn}
          onClose={() => setDiffTurn(null)}
        />
      )}
      {undoTurn !== null && (
        <UndoSheet
          turnNo={undoTurn}
          turns={turns}
          agentName="Claude"
          onClose={() => setUndoTurn(null)}
        />
      )}
    </div>
  );
}
