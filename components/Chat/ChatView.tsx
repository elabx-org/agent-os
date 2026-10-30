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
import { ComposerChips, useComposer } from "@/components/Composer";
import { ComposerCard } from "@/components/Composer/ComposerCard";
import { PausedBar } from "@/components/Session/PausedBar";
import { PausedHistory } from "@/components/Session/PausedHistory";
import { SettledBar } from "@/components/Session/SettledBar";
import { isEnded, isSettled } from "@/lib/settle-types";
import {
  RewindSheet,
  useClaudeLive,
} from "@/components/Composer/ClaudeStateBar";
import { StopPill } from "@/components/Session/StopPill";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useQueue } from "@/hooks/useQueue";
import { useTurns } from "@/hooks/useTurns";
import { useSearchAction } from "@/hooks/useSearchAction";
import { useSessionPrompt } from "@/data/prompts/queries";
import { DeckActions } from "@/components/DeckActions";
import { DeckStateLine } from "@/components/DeckStateLine";
import { useSubagents, useWorkflows } from "@/hooks/useSubagents";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
import { agentOpenStore, consumeSubagent } from "@/stores/agentOpen";
import { bgSendStore } from "@/stores/bgSend";
import type { Session } from "@/lib/db";
import { WorkflowPanel, workflowAgentInfo } from "@/components/WorkflowPhases";
import { DiffReview } from "@/components/DiffViewer/DiffReview";
import { FOLD_CLEAR } from "@/hooks/useHinge";
import { diffReviewStore, openDiffReview } from "@/stores/diffReview";
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
import { RunningCardSlot } from "@/components/Running/RunningCard";
import { ImageViewer } from "@/components/ImageViewer";
import { isImageUrl } from "@/components/Composer/ImagePill";
import { LastMinePill } from "@/components/LastMinePill";
import { useImageEvents } from "@/lib/client/image-view";
import { NeedsYouCard } from "./NeedsYouCard";
import { buildRows, placeTurns } from "./rows";
import { SubagentPanel } from "./SubagentPanel";
import { SubagentRow } from "./ToolCard";
import { UndoSheet } from "./UndoSheet";
import { FreshSessionHint } from "./FreshSessionHint";
import { SentToast } from "./SentToast";
import { SendMenuDim } from "@/components/Composer/SendMenuDim";
import { useSeam } from "./useSeam";
import { useTranscript } from "./useTranscript";
import type { DirectSendOptions } from "@/lib/session-attach-types";

export interface ChatViewProps {
  session: Session;
  /** Only poll while the view is showing */
  active: boolean;
  /** The activity strip above shows the agents, so the pill row goes */
  hideAgentsBar?: boolean;
  onOpenTerminal: () => void;
  /** Told when the fold deck starts or stops: its state line replaces the strip */
  onDeck?: (on: boolean) => void;
  /** The transcript was read and has nothing in it (or there is none) */
  onEmpty?: () => void;
}

/** Claude Code's session as a conversation, read from its transcript */
export function ChatView({
  session,
  active,
  hideAgentsBar,
  onOpenTerminal,
  onDeck,
  onEmpty,
}: ChatViewProps) {
  const transcriptBase = `/api/sessions/${session.id}`;
  const { items, state, settledFor, truncated, loadEarlier, loadingEarlier } =
    useTranscript(transcriptBase, active);
  // Read for this session and still empty a moment later: a transcript
  // that's briefly not found (a new Claude session) doesn't count
  const empty =
    settledFor === transcriptBase &&
    (state === "missing" || (state === "ready" && !items.length));
  // A fresh session (M10) stays in the chat while it's still empty; once
  // something was sent from it, the usual missing/empty handling is back
  const freshEntry = useSnapshot(bgSendStore).fresh[session.id];
  const fresh = !!freshEntry && !freshEntry.sent;
  const menuHere = useSnapshot(bgSendStore).menuFor === session.id;
  useEffect(() => {
    if (!empty || !onEmpty || fresh) return;
    const timer = setTimeout(onEmpty, 800);
    return () => clearTimeout(timer);
  }, [empty, onEmpty, fresh]);
  const { statuses, nativeKeyboard } = useSnapshot(mobileNavStore);
  const status = statuses[session.id]?.status;
  // Handed off to another agent (M4) or settled (M8): its tmux ended, the
  // chat stays readable
  const paused = isEnded(session);
  const settled = isSettled(session);
  const pausedOther = paused && (session.agent_type || "claude") !== "claude";
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
            // The open turn's Diff closes it again
            onDiff: (n) => setDiffTurn((open) => (open === n ? null : n)),
            onUndo: setUndoTurn,
            diffTurn,
          }
        : undefined,
    [turns.enabled, turns.turns, rows, diffTurn]
  );
  useEffect(() => {
    setDiffTurn(null);
    setUndoTurn(null);
  }, [session.id]);
  // Search's "Undo turn N" / "Open diff: This turn" (M11)
  useSearchAction(session.id, "turn", active, (r) =>
    r.action === "undo" ? setUndoTurn(r.turnNo) : setDiffTurn(r.turnNo)
  );

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
  // One right page at a time: the latest of an agent and a turn's diff
  useEffect(() => {
    if (openAgent || openRun) setDiffTurn(null);
  }, [openAgent, openRun]);
  useEffect(() => {
    if (diffTurn === null) return;
    setOpenAgent(null);
    setOpenRun(null);
  }, [diffTurn]);
  // Beside the pane where SessionSpread has room (O-Diff's right page,
  // D-Diff's room beside the chat), so the session header covers the
  // conversation only; over the chat everywhere else
  const { room: reviewRoom } = useSnapshot(diffReviewStore);
  const reviewBeside = active && reviewRoom === session.id;
  useEffect(() => {
    if (diffTurn === null || !reviewBeside) return;
    return openDiffReview(
      { sessionId: session.id, turnNo: diffTurn },
      { close: () => setDiffTurn(null), undoTurn: setUndoTurn }
    );
  }, [diffTurn, reviewBeside, session.id]);
  const reviewHere = diffTurn !== null && !reviewBeside;
  // What takes the right page: an agent, a whole workflow or a turn's diff
  const side = !!opened || !!openedRun || reviewHere;

  // Focus on the open Duo: the conversation reads across both pages like a
  // book, earlier rows on the left page and the latest with the composer on
  // the right. An open subagent takes the right page instead.
  const outerRef = useRef<HTMLDivElement>(null);
  const pages = useSpreadPages(outerRef, useSpreadFold());
  const mode = useLayoutMode();
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
  // A search hit far back: load earlier pages until it's there (M11)
  useChatJump(
    session.id,
    active,
    findItem,
    truncated && !loadingEarlier ? loadEarlier : undefined
  );

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
    active,
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
  // A picture in the conversation, full screen; it can go back into the
  // message from there
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  useImageEvents(outerRef, setViewingImage);

  // "Your last message" while it's above the view (a long reply after it)
  const [mineAbove, setMineAbove] = useState(false);
  const lastMine = useCallback(() => {
    const all = scrollRef.current?.querySelectorAll(".bubble-me");
    return all?.length ? all[all.length - 1] : null;
  }, []);
  const checkMine = useCallback(() => {
    const el = scrollRef.current;
    const mine = lastMine();
    setMineAbove(
      !!el &&
        !!mine &&
        mine.getBoundingClientRect().bottom < el.getBoundingClientRect().top
    );
  }, [lastMine]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(checkMine);
    };
    const changes = new MutationObserver(soon);
    changes.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", soon, { passive: true });
    soon();
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      el.removeEventListener("scroll", soon);
    };
  }, [checkMine]);
  // "Edit and resend": a sent message back in the box, after what's typed
  const reuseMessage = useCallback((text: string) => {
    const c = composerRef.current;
    if (c.draft.trim()) c.insert(text, true);
    else c.replace(text);
    c.textareaRef.current?.focus();
  }, []);
  const jumpToMine = () =>
    lastMine()?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });

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
    async (text: string, options?: DirectSendOptions) => {
      if (!text.trim()) return;
      const res = await fetchAsUser(`/api/sessions/${session.id}/send-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          pressEnter: true,
          ...(options?.sessions?.length ? { sessions: options.sessions } : {}),
        }),
      });
      if (!res.ok) {
        // A 409: the attached sessions can't go with an answer (send-keys)
        const body = await res.json().catch(() => null);
        throw new Error(
          res.status === 409 && body?.error
            ? body.error
            : "Couldn't send to Claude"
        );
      }
      sent();
    },
    [session.id, sent]
  );
  // The header's inset (Closed-Chat 20px, Fold, open Duo and desktop
  // 24px); the composer row sits 16px in on the closed Duo and the phone
  const roomy = mode !== "duo-closed" && mode !== "phone";
  const inset = roomy ? "px-6" : "px-5";
  const controlsPad = roomy ? 24 : 16;
  // Desktop: one centred 672px column for the chat and the composer
  const column = mode === "desktop" ? "max-w-[672px]" : "max-w-3xl";

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
          // On the deck, the state line above names who asks
          noHead={!!deckControls}
        />
      )}
      <LimitedCardSlot session={session} />
      <RunningCardSlot session={session} active={active} />
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
    <div
      ref={outerRef}
      // Its container query makes it a stacking layer: above the pane's
      // dim while the send menu is open, with its own dim inside
      className={cn(
        "@container/chat relative flex h-full",
        menuHere && "z-[11]"
      )}
    >
      <SendMenuDim sessionId={session.id} />
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
              "bg-background min-h-0 shrink-0 overflow-y-auto pt-3",
              inset,
              !controlPages &&
                "pb-[calc(0.75rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]"
            )}
            // The composer runs under this page too
            style={{
              width: pages.left,
              paddingBottom: controlPages ? controlsHeight + 12 : undefined,
            }}
          >
            <div
              className={cn(
                "mx-auto flex min-h-full flex-col justify-end gap-3",
                column
              )}
            >
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
                  onReuse={reuseMessage}
                  sessionId={session.id}
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
        {/* N-BgSend: "Sent to <name>" floats over the top of the chat */}
        <div className="relative z-20 h-0 shrink-0">
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 top-2",
              inset
            )}
          >
            <div className={cn("pointer-events-auto mx-auto", column)}>
              <SentToast sessionId={session.id} />
            </div>
            <div className="mt-2 flex justify-center">
              <LastMinePill
                visible={mineAbove}
                onJump={jumpToMine}
                className="pointer-events-auto"
              />
            </div>
          </div>
        </div>
        <div
          ref={scrollRef}
          {...quoteMenu.handlers}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className={cn("min-h-0 flex-1 overflow-y-auto py-3", inset)}
        >
          <div className={cn("mx-auto flex flex-col gap-3", column)}>
            {state === "loading" && (
              <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the
                conversation…
              </div>
            )}
            {/* Handed off or settled: no terminal to open. Codex and Gemini
                keep no transcript, so theirs as it was when it ended */}
            {state === "missing" &&
              paused &&
              (pausedOther ? (
                <PausedHistory session={session} />
              ) : (
                <div className="text-muted-foreground py-8 text-sm">
                  No Claude Code conversation was found for this session.
                </div>
              ))}
            {fresh &&
              !paused &&
              (state === "missing" || (state === "ready" && !items.length)) && (
                <FreshSessionHint session={session} />
              )}
            {state === "missing" && !paused && !fresh && (
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
                  onReuse={reuseMessage}
                  sessionId={session.id}
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
                  onReuse={reuseMessage}
                  sessionId={session.id}
                />
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
            "pt-1.5 pb-[calc(0.625rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]",
            roomy ? "px-6" : "px-4",
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
          {/* The deck's first line, just under the fold (Fold-Chat) */}
          {deck && (
            <DeckStateLine
              session={session}
              active={active}
              className="-mx-6 pt-0"
            />
          )}
          {deckControls && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-1.5 pb-3">
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
            className={cn(
              "relative shrink-0",
              !controlPages && mode === "desktop" && "mx-auto w-full",
              !controlPages && mode === "desktop" && column
            )}
            // Less the container's padding, so it ends where the page does
            style={
              controlPages
                ? { width: controlPages.left - controlsPad }
                : undefined
            }
          >
            {/* Handed off: Open the new session or Resume here; settled:
                Resume. In place of the composer (its transcript still reads
                above) */}
            {paused &&
              (settled ? (
                <SettledBar session={session} />
              ) : (
                <PausedBar session={session} />
              ))}
            {!paused && (
              <RewindSheet
                live={live}
                cwd={composer.cwd}
                onRewound={onOpenTerminal}
              />
            )}
            {!paused && (
              <ComposerCard
                composer={composer}
                sessionId={session.id}
                session={session}
                agentName="Claude"
                inlinePlus={mode === "desktop"}
                queue={queue}
                onSendDirect={sendDirect}
                onSent={sent}
                placeholder={
                  mode !== "desktop"
                    ? "Reply to Claude"
                    : diffTurn !== null
                      ? // D-Diff: the chat is narrower beside the review
                        "Reply to Claude, / for commands"
                      : "Reply to Claude, / for commands, @ for files"
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
            )}
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
      {viewingImage && (
        <ImageViewer
          path={viewingImage}
          // A pasted picture has no file to put in a message
          onAdd={
            isImageUrl(viewingImage)
              ? undefined
              : () => {
                  setViewingImage(null);
                  composer.insert(`${viewingImage} `, true);
                }
          }
          onClose={() => setViewingImage(null)}
        />
      )}
      {reviewHere && diffTurn !== null && (
        <DiffReview
          session={session}
          agentName="Claude"
          initialScope={`turn:${diffTurn}`}
          // Beside the conversation on the open Duo (O-Diff) and the
          // desktop (D-Diff); over it on the closed Duo and the phone
          placement={pages || mode === "desktop" ? "page" : "screen"}
          onClose={() => setDiffTurn(null)}
          onUndoTurn={setUndoTurn}
          className={
            pages
              ? "min-w-0 flex-1"
              : mode === "desktop"
                ? "bg-background absolute inset-0 z-10 @2xl/chat:static @2xl/chat:w-[62%] @2xl/chat:max-w-[60rem] @2xl/chat:shrink-0"
                : // Over the conversation, inside the chat's own box (the
                  // closed Duo's column stays clear; UndoSheet is above)
                  "bg-background absolute inset-0 z-10"
          }
          // On a table: above the fold (clear of the hinge, as the
          // column's rule), the composer stays on the deck
          style={
            deck && !pages && mode !== "desktop"
              ? {
                  bottom: deck.deck + deck.gap,
                  paddingBottom: Math.max(0, FOLD_CLEAR - deck.gap / 2),
                }
              : undefined
          }
        />
      )}
      {/* On a table while typing: Claude's last turn over the chat above */}
      <DeckContext
        sessionId={session.id}
        view="chat"
        on={!!deck && active && diffTurn === null}
        cover={scrollRef}
      />
      {quoteMenu.menu}
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
