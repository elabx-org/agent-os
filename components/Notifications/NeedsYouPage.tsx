"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Bell, ChevronLeft, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmAction } from "@/components/ui/confirm";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { GroupCard, GroupRow } from "@/components/a/GroupCard";
import { InboxItem } from "@/components/Inbox";
import { PermissionCard } from "@/components/Composer/PermissionCard";
import { shortAge } from "@/components/MissionControl/now-summary";
import {
  PROMPT_POLL_SLOW_MS,
  useAnswerPrompt,
  useSessionPrompt,
} from "@/data/prompts/queries";
import {
  home,
  useBackgroundAgentsByProject,
} from "@/components/BackgroundAgents";
import {
  AgentCrumb,
  AgentDetail,
} from "@/components/BackgroundAgents/AgentDetail";
import type { PageProps } from "@/components/WorkspacePage";
import { FoldSplit } from "@/components/FoldSplit";
import {
  useSpreadFold,
  type SpreadFold,
} from "@/components/views/SessionSpread";
import type { ViewProps } from "@/components/views/types";
import { useNeedsYou, type NotificationEntry } from "@/hooks/useNeedsYou";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { FOLD_CLEAR } from "@/hooks/useHinge";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode, type LayoutMode } from "@/hooks/useLayoutMode";
import { useReplyContextState } from "@/hooks/useReplyContext";
import { STATE_TEXT_CLASS } from "@/lib/agent-state";
import { nativeCaps } from "@/lib/native-bridge";
import { registerNavHandlers, runNav } from "@/lib/nav-actions";
import {
  isAnswerableQuestion,
  shortLabel,
  splitOptions,
} from "@/lib/permission-card";
import { cn } from "@/lib/utils";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { openSettings } from "@/stores/settingsPage";
import { backPage, openPage, workspacePageStore } from "@/stores/workspacePage";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { Session } from "@/lib/db";
import type { PermissionPrompt } from "@/lib/permission-prompt";
import { HistoryCard } from "./HistoryCard";
import { askLine, historyDays } from "./history-rows";

/** Opening the page marks what it shows as read, once it has been seen */
const MARK_READ_MS = 2000;
/** History kept below what needs you now */
const EARLIER_MAX = 50;
/** Narrower than this a page lists everything in one column */
const SPLIT_MIN_WIDTH = 720;

/** The mocks' page padding per posture (E-NeedsYou, E-iPhone, Open-Now) */
const PAD: Record<LayoutMode, string> = {
  phone: "px-4 pt-[15px]",
  "duo-closed": "pt-[18px] pr-2 pl-5",
  tabletop: "px-4 pt-4",
  "duo-open": "pt-5 pr-5 pl-6",
  book: "pt-5 pr-5 pl-6",
  desktop: "pt-5 pr-5 pl-6",
};

type Picked = {
  kind: "session" | "agent";
  id: string;
  /** The history row it was picked from, shown selected */
  entryId?: string;
};

interface Group {
  key: string;
  name: string;
  sessions: Session[];
  agents: BackgroundAgent[];
}

/** One thing waiting on you, with the project it's in */
type Waiting =
  | { kind: "session"; session: Session; projectName: string }
  | { kind: "agent"; agent: BackgroundAgent; projectName: string };

/** The last folder of a path, for things outside every project */
function folderName(dir: string): string {
  return home(dir).replace(/\/+$/, "").split("/").pop() || dir;
}

/**
 * What the page lists: waiting sessions and blocked agents by project, the
 * history split into what finished since you last looked and the rest,
 * and whether it has been seen (marked read after a moment).
 */
function useNeedsYouList(view: ViewProps) {
  const { sessions, sessionStatuses, projects } = view;
  const needs = useNeedsYou(sessions, sessionStatuses);
  const titles = useListTitles(needs.waiting);
  const agentsByProject = useBackgroundAgentsByProject(projects);
  const { history, unread, markRead, clearHistory } = needs;

  const groups = useMemo(() => {
    const named = new Map(
      projects
        .filter((p) => !p.is_uncategorized && p.name !== "Uncategorized")
        .map((p) => [p.id, p.name])
    );
    const agentProject = new Map<string, string>();
    for (const [projectId, agents] of Object.entries(agentsByProject))
      for (const agent of agents) agentProject.set(agent.id, projectId);

    const byKey = new Map<string, Group>();
    const group = (key: string, name: string) => {
      let g = byKey.get(key);
      if (!g) byKey.set(key, (g = { key, name, sessions: [], agents: [] }));
      return g;
    };
    // Sessions first (most recently used), then the projects only agents wait in
    for (const session of needs.waiting) {
      const name = session.project_id && named.get(session.project_id);
      if (name) group(session.project_id!, name).sessions.push(session);
      else
        group(
          `dir:${folderName(session.working_directory)}`,
          folderName(session.working_directory)
        ).sessions.push(session);
    }
    for (const agent of needs.blocked) {
      const projectId = agentProject.get(agent.id);
      const name = projectId && named.get(projectId);
      if (name) group(projectId!, name).agents.push(agent);
      else
        group(
          `dir:${folderName(agent.cwd)}`,
          folderName(agent.cwd)
        ).agents.push(agent);
    }
    return [...byKey.values()];
  }, [projects, agentsByProject, needs.waiting, needs.blocked]);

  // One list, a project's items together; the card names the project
  const waiting = useMemo<Waiting[]>(
    () =>
      groups.flatMap((g) => [
        ...g.sessions.map(
          (session): Waiting => ({
            kind: "session",
            session,
            projectName: g.name,
          })
        ),
        ...g.agents.map(
          (agent): Waiting => ({ kind: "agent", agent, projectName: g.name })
        ),
      ]),
    [groups]
  );

  // What was new when it showed stays under Finished for this visit, after
  // it has been marked read
  const [fresh, setFresh] = useState<ReadonlySet<string>>(
    () => new Set(history.filter((i) => !i.read).map((i) => i.id))
  );
  useEffect(() => {
    const added = history.filter((i) => !i.read && !fresh.has(i.id));
    if (added.length)
      setFresh((prev) => new Set([...prev, ...added.map((i) => i.id)]));
  }, [history, fresh]);

  const visible = usePageVisible();
  useEffect(() => {
    if (!unread || !visible) return;
    const timer = setTimeout(() => markRead("all"), MARK_READ_MS);
    return () => clearTimeout(timer);
  }, [unread, visible, markRead]);

  const finished = history.filter(
    (i) =>
      fresh.has(i.id) && (i.kind === "finished" || i.kind === "agentFinished")
  );
  // A prompt still waiting is listed above, live, so its alerts aren't
  // repeated below
  const waitingIds = new Set<string>([
    ...needs.waiting.map((s) => s.id),
    ...needs.blocked.map((a) => a.id),
  ]);
  const earlier = history
    .filter(
      (i) =>
        !finished.includes(i) &&
        !(
          (i.kind === "needsYou" || i.kind === "agentNeedsYou") &&
          waitingIds.has(i.sessionId ?? i.agentId ?? "")
        )
    )
    .slice(0, EARLIER_MAX);

  return {
    count: needs.count,
    waiting,
    titles,
    agents: needs.agents,
    finished,
    earlier,
    hasHistory: history.length > 0,
    clearHistory,
  };
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

type NeedsYouList = ReturnType<typeof useNeedsYouList>;

/**
 * Clear history, the column's trash (and the in-page one): asks first, and
 * leaves what still waits, which is the sessions' live state
 */
function useClearHistory(list: NeedsYouList) {
  const { hasHistory, clearHistory } = list;
  const clear = useCallback(async () => {
    if (!hasHistory) {
      toast("Nothing to clear");
      return;
    }
    const ok = await confirmAction({
      title: "Clear notification history?",
      message: "What still needs you stays here.",
      confirmLabel: "Clear history",
      destructive: true,
    });
    if (ok) clearHistory();
  }, [hasHistory, clearHistory]);
  useEffect(() => registerNavHandlers({ clearHistory: clear }), [clear]);
  return clear;
}

/**
 * Bell and trash on the page itself, only where no column or bar has them:
 * the phone's tab bar, the iOS app before it takes the column, the dialog
 */
function useInPageControls(dialog?: boolean) {
  const mode = useLayoutMode();
  const native = useIsNative();
  if (dialog) return { controls: true, back: false };
  const column = native ? nativeCaps().column : mode !== "phone";
  return { controls: !column, back: native && !column };
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-muted-foreground active:bg-accent hover:bg-accent grid h-11 w-11 shrink-0 place-items-center rounded-full"
    >
      {children}
    </button>
  );
}

/** The large title, with back, bell and trash where nothing else has them */
function Title({
  dialog,
  onSettings,
  onClear,
}: {
  dialog?: boolean;
  onSettings: () => void;
  onClear: () => void;
}) {
  const { controls, back } = useInPageControls(dialog);
  const title = <h1 className="t-large min-w-0 truncate">Needs you</h1>;
  return (
    <div className="flex flex-col">
      {back && (
        <button
          type="button"
          onClick={() => runNav("back")}
          aria-label="Back"
          className="text-muted-foreground active:bg-accent -ml-2 flex h-11 w-11 items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <header className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          {dialog ? <DialogTitle asChild>{title}</DialogTitle> : title}
        </div>
        {controls && (
          <>
            <HeaderButton label="Notification settings" onClick={onSettings}>
              <Bell className="h-5 w-5" />
            </HeaderButton>
            <HeaderButton label="Clear history" onClick={onClear}>
              <Trash2 className="h-5 w-5" />
            </HeaderButton>
          </>
        )}
      </header>
    </div>
  );
}

/** With nothing waiting: never a lone "All clear", the history follows */
function NothingNeedsYou({ quiet }: { quiet: boolean }) {
  return (
    <div className="px-1 py-2">
      <p className="font-medium">Nothing needs you</p>
      <p className="text-muted-foreground text-sm">
        {quiet
          ? "Sessions waiting on you, and background agents that ask or finish, show up here."
          : "What happened lately is below."}
      </p>
    </div>
  );
}

/** The question as one line: a command set in mono ("Run `…`?") */
function AskText({
  prompt,
}: {
  prompt: Pick<PermissionPrompt, "title" | "detail" | "question">;
}) {
  const { text, code, after } = askLine(prompt);
  return (
    <>
      {text}
      {code && <span className="font-mono text-[13px]">{code}</span>}
      {after}
    </>
  );
}

/** The card's header: the agent's tile, "<title> · <project>", the age */
function CardHeader({
  agentType,
  label,
  age,
}: {
  agentType: string | null | undefined;
  label: string;
  age?: string;
}) {
  return (
    <span className="text-muted-foreground flex w-full min-w-0 items-center gap-2 text-[13px]">
      <Avatar
        {...agentAvatar(agentType)}
        size="sm"
        className="h-5 w-5 rounded-[6px] text-[10px]"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {age && <span className="shrink-0">{age}</span>}
    </span>
  );
}

// Taps on the header and question open the session; the answers don't
const OPEN_TARGET =
  "relative flex min-w-0 flex-col gap-1.5 text-left after:absolute after:inset-x-0 after:-top-3.5 after:-bottom-1 after:content-['']";

/**
 * A waiting session as E-NeedsYou's card: who and where, the question,
 * then its answers as pills. Permission requests answer through M0's
 * PermissionCard (the user's alone); questions as the Inbox card does
 */
function AskCard({
  session,
  title,
  projectName,
  pollMs,
  onOpen,
}: {
  session: Session;
  title: string;
  projectName?: string;
  pollMs?: number;
  onOpen: () => void;
}) {
  const { data: prompt, isLoading: promptLoading } = useSessionPrompt(
    session.id,
    { pollMs }
  );
  const { answer, answering, error } = useAnswerPrompt(session.id);
  // Classified as the server's guard does: unclear means permission. Until
  // the context is in, it's neither card
  const { context, loading: contextLoading } = useReplyContextState(
    session.id,
    !!prompt
  );
  const loading = promptLoading || (!!prompt && contextLoading);
  const question =
    !!prompt && !contextLoading && isAnswerableQuestion(context, prompt);
  const permission =
    prompt && !contextLoading && !question ? { tool: null, prompt } : null;
  const split = question && prompt ? splitOptions(prompt.options) : null;

  return (
    <div className="ask-card gap-1.5">
      <button type="button" onClick={onOpen} className={OPEN_TARGET}>
        <CardHeader
          agentType={session.agent_type}
          label={[title, projectName].filter(Boolean).join(" · ")}
          age={shortAge(session.updated_at)}
        />
        {loading ? (
          <span className="text-muted-foreground flex items-center gap-2 text-[16px]">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the session…
          </span>
        ) : (
          // Until PermissionCard has its "ask" variant, "now" shows the
          // command beside its answers
          !permission && (
            <span className="w-full text-[16px] font-medium break-words">
              {prompt ? <AskText prompt={prompt} /> : "Needs a typed reply"}
            </span>
          )
        )}
      </button>

      {permission && (
        <PermissionCard
          session={session}
          permission={permission}
          variant="now"
          onOpen={onOpen}
        />
      )}

      {(split || (!loading && !prompt)) && (
        <div className="mt-1 flex gap-2">
          {split?.main.map((option, i) => (
            <button
              key={`${option.index}-${option.label}`}
              type="button"
              title={option.label}
              disabled={answering !== null}
              onClick={() => answer(option)}
              className={cn(
                "pill pill-sm min-w-0 flex-1 touch-manipulation disabled:opacity-60",
                // The first answer is the one that lets it go on
                i === 0
                  ? "pill-primary active:opacity-80"
                  : "pill-secondary active:bg-accent"
              )}
            >
              {answering === option.index && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              )}
              <span className="truncate">{shortLabel(option)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${title}`}
            className={cn(
              "pill pill-sm shrink-0 touch-manipulation",
              split
                ? "pill-secondary active:bg-accent"
                : "pill-primary active:opacity-80"
            )}
          >
            Open
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** A background agent stopped to ask: it answers on its own page */
function BlockedCard({
  agent,
  projectName,
  onOpen,
}: {
  agent: BackgroundAgent;
  projectName: string;
  onOpen: () => void;
}) {
  return (
    <div className="ask-card gap-1.5">
      <button type="button" onClick={onOpen} className={OPEN_TARGET}>
        <CardHeader
          agentType="claude"
          label={`${agent.name} · ${projectName}`}
          // 0 means the state file didn't say
          age={agent.startedAt ? shortAge(agent.startedAt) : undefined}
        />
        <span className="w-full text-[16px] font-medium">
          A background agent is waiting for you
        </span>
      </button>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="pill pill-sm pill-primary flex-1 touch-manipulation active:opacity-80"
        >
          Open to answer
        </button>
      </div>
    </div>
  );
}

/** A waiting session as a row to pick (open Duo, table): what it asks */
function WaitingRow({
  session,
  title,
  pollMs,
  selected,
  onClick,
}: {
  session: Session;
  title: string;
  pollMs?: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { data: prompt } = useSessionPrompt(session.id, { pollMs });
  return (
    <GroupRow
      leading={<Avatar {...agentAvatar(session.agent_type)} />}
      title={title}
      subtitle={prompt ? <AskText prompt={prompt} /> : "Your turn"}
      trailing={shortAge(session.updated_at)}
      selected={selected}
      onClick={onClick}
    />
  );
}

/** The first waiting prompt is reread every 2s, the rest less often: each
    read is a tmux capture on the server */
const pollFor = (index: number) =>
  index === 0 ? undefined : PROMPT_POLL_SLOW_MS;

/** "Finished" (new since you looked), then the history by day */
function History({
  list,
  sessions,
  selectedId,
  onOpenSession,
  onOpenAgent,
}: {
  list: NeedsYouList;
  sessions: Session[];
  selectedId?: string;
  onOpenSession: (session: Session) => void;
  onOpenAgent: (agent: BackgroundAgent, entry: NotificationEntry) => void;
}) {
  const openFor = (entry: NotificationEntry) => {
    if (entry.agentId) {
      const agent = list.agents.find((a) => a.id === entry.agentId);
      return agent && (() => onOpenAgent(agent, entry));
    }
    const session = sessions.find((s) => s.id === entry.sessionId);
    return session && (() => onOpenSession(session));
  };
  return (
    <>
      <HistoryCard
        title="Finished"
        entries={list.finished}
        openFor={openFor}
        selectedId={selectedId}
      />
      {historyDays(list.earlier).map((day) => (
        <HistoryCard
          key={day.title}
          title={day.title}
          entries={day.entries}
          openFor={openFor}
          selectedId={selectedId}
        />
      ))}
    </>
  );
}

/** The list's width, then the gap across the fold */
interface Split {
  left: number | string;
  gutter: number;
}
const FIXED: Split = { left: "38%", gutter: 0 };

/**
 * The list | detail layout's pages: around the fold where the page spans
 * the open Duo, else a fixed split once there's room; null for one column
 */
function useSplit(
  ref: RefObject<HTMLElement | null>,
  fold: SpreadFold | null,
  always: boolean
): Split | null {
  const [split, setSplit] = useState<Split | null>(always ? FIXED : null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      let next: Split | null;
      if (fold) {
        // Flat there's no gutter, but both pages keep clear of the hinge
        const clear = fold.end > fold.start ? 0 : FOLD_CLEAR;
        next = {
          left: Math.round(fold.start - clear - rect.left),
          gutter: Math.round(fold.end - fold.start + clear * 2),
        };
      } else {
        next = always || rect.width >= SPLIT_MIN_WIDTH ? FIXED : null;
      }
      setSplit((prev) =>
        prev?.left === next?.left && prev?.gutter === next?.gutter ? prev : next
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fold, always]);
  return split;
}

interface NeedsYouProps {
  view: ViewProps;
  onOpenSession: (session: Session) => void;
  /** The dialog's list | detail, at any width */
  dialog?: boolean;
  /** Leaves the page or the dialog */
  onClose: () => void;
}

/**
 * Everything that needs you, then what finished and what happened before.
 * One column on a phone and the closed Duo, where prompts are answered in
 * place; list | detail on the open Duo (across the fold) and in the
 * desktop dialog.
 */
function NeedsYou({ view, onOpenSession, dialog, onClose }: NeedsYouProps) {
  const list = useNeedsYouList(view);
  const ref = useRef<HTMLDivElement>(null);
  const split = useSplit(ref, useSpreadFold(), !!dialog);
  const onClear = useClearHistory(list);

  const onSettings = () => {
    onClose();
    openSettings("notifications");
  };
  const quiet = !list.count && !list.finished.length && !list.earlier.length;
  const title = (
    <Title dialog={dialog} onSettings={onSettings} onClear={onClear} />
  );

  // One root whatever the layout, so the split keeps measuring it
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {split ? (
        <SplitLayout
          list={list}
          view={view}
          split={split}
          dialog={dialog}
          title={title}
          quiet={quiet}
          onOpenSession={onOpenSession}
        />
      ) : (
        <OneColumn
          pageRef={ref}
          list={list}
          view={view}
          title={title}
          quiet={quiet}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  );
}

/**
 * Which item the detail shows: the picked one while it's still there, else
 * the first that waits
 */
function usePicked(list: NeedsYouList, view: ViewProps) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const isItem = (p: Picked) =>
    p.kind === "session"
      ? list.waiting.some((w) => w.kind === "session" && w.session.id === p.id)
      : // An agent may be picked from the history while it exists
        list.agents.some((a) => a.id === p.id);
  const first = list.waiting[0];
  const current: Picked | null =
    picked && isItem(picked)
      ? picked
      : first?.kind === "session"
        ? { kind: "session", id: first.session.id }
        : first?.kind === "agent"
          ? { kind: "agent", id: first.agent.id }
          : null;

  return {
    isPicked: (kind: Picked["kind"], id: string) =>
      current?.kind === kind && current.id === id && !current.entryId,
    entryId: current?.entryId,
    pick: setPicked,
    session:
      current?.kind === "session"
        ? view.sessions.find((s) => s.id === current.id)
        : undefined,
    agent:
      current?.kind === "agent"
        ? list.agents.find((a) => a.id === current.id)
        : undefined,
  };
}

type PickedItem = ReturnType<typeof usePicked>;

/** The list as rows to pick from (Open-Now): the detail shows the picked one */
function PickList({
  list,
  view,
  picked,
  title,
  quiet,
  onOpenSession,
  className,
}: {
  list: NeedsYouList;
  view: ViewProps;
  picked: PickedItem;
  title: ReactNode;
  quiet: boolean;
  onOpenSession: (session: Session) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Needs you"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain",
        className
      )}
    >
      {title}
      {list.waiting.length === 0 ? (
        <NothingNeedsYou quiet={quiet} />
      ) : (
        <GroupCard aria-label="Waiting on you">
          {list.waiting.map((w, i) =>
            w.kind === "session" ? (
              <WaitingRow
                key={w.session.id}
                session={w.session}
                title={displayTitle(w.session, list.titles).title}
                pollMs={pollFor(i)}
                selected={picked.isPicked("session", w.session.id)}
                onClick={() =>
                  picked.pick({ kind: "session", id: w.session.id })
                }
              />
            ) : (
              <GroupRow
                key={w.agent.id}
                leading={<Avatar {...agentAvatar("claude")} />}
                title={w.agent.name}
                subtitle={`${w.projectName} · Background agent waiting`}
                trailing={
                  w.agent.startedAt ? shortAge(w.agent.startedAt) : null
                }
                selected={picked.isPicked("agent", w.agent.id)}
                onClick={() => picked.pick({ kind: "agent", id: w.agent.id })}
              />
            )
          )}
        </GroupCard>
      )}
      <History
        list={list}
        sessions={view.sessions}
        selectedId={picked.entryId}
        onOpenSession={onOpenSession}
        onOpenAgent={(a, entry) =>
          picked.pick({ kind: "agent", id: a.id, entryId: entry.id })
        }
      />
    </nav>
  );
}

/** The detail page's header: "project · Claude · Needs you", the title */
function DetailHeader({
  crumb,
  title,
  dialog,
}: {
  crumb: ReactNode;
  title: string;
  dialog?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 flex-col gap-1 px-6 pt-5 pb-3",
        // Clear of the dialog's close button
        dialog && "pr-14"
      )}
    >
      <p className="text-muted-foreground truncate text-[15px]">{crumb}</p>
      <h2 className="t-title truncate">{title}</h2>
    </header>
  );
}

const NeedsWord = () => (
  <span className={STATE_TEXT_CLASS.needs}>Needs you</span>
);

/** The picked prompt, answerable in place, or the picked agent */
function PickedDetail({
  list,
  picked,
  dialog,
  onOpenSession,
}: {
  list: NeedsYouList;
  picked: PickedItem;
  dialog?: boolean;
  onOpenSession: (session: Session) => void;
}) {
  const { session, agent } = picked;
  if (session) {
    const projectName = list.waiting.find(
      (w) => w.kind === "session" && w.session.id === session.id
    )?.projectName;
    return (
      <>
        <DetailHeader
          dialog={dialog}
          title={displayTitle(session, list.titles).title}
          crumb={
            <>
              {[projectName, agentName(session.agent_type)]
                .filter(Boolean)
                .join(" · ")}
              {" · "}
              <NeedsWord />
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-1 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <InboxItem
            key={session.id}
            as="div"
            variant="page"
            session={session}
            onOpen={() => onOpenSession(session)}
          />
        </div>
      </>
    );
  }
  if (agent)
    return (
      <>
        <DetailHeader
          dialog={dialog}
          title={agent.name}
          crumb={
            agent.state === "blocked" ? (
              <>
                Background agent · <NeedsWord />
              </>
            ) : (
              "Background agent"
            )
          }
        />
        <p className="text-muted-foreground -mt-2 truncate px-6 pb-2 font-mono text-[11px]">
          <AgentCrumb agent={agent} />
        </p>
        <AgentDetail
          key={agent.id}
          agent={agent}
          layout="page"
          onClose={() => picked.pick(null)}
        />
      </>
    );
  return (
    <div className="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6 text-center text-sm">
      Nothing needs you
    </div>
  );
}

/** The list on the left page, the picked prompt or agent on the right */
function SplitLayout({
  list,
  view,
  split,
  dialog,
  title,
  quiet,
  onOpenSession,
}: {
  list: NeedsYouList;
  view: ViewProps;
  split: Split;
  dialog?: boolean;
  title: ReactNode;
  quiet: boolean;
  onOpenSession: (session: Session) => void;
}) {
  const picked = usePicked(list, view);

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "flex shrink-0 flex-col",
          !split.gutter && "border-border border-r"
        )}
        style={{ width: split.left }}
      >
        {dialog && (
          <DialogDescription className="sr-only">
            {list.count ? `${list.count} waiting on you` : "Nothing needs you"}
          </DialogDescription>
        )}
        <PickList
          list={list}
          view={view}
          picked={picked}
          title={title}
          quiet={quiet}
          onOpenSession={onOpenSession}
          className={cn(
            PAD["duo-open"],
            "pb-[calc(1rem+env(safe-area-inset-bottom))]"
          )}
        />
      </aside>
      {split.gutter > 0 && (
        <div aria-hidden="true" style={{ width: split.gutter }} />
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <PickedDetail
          list={list}
          picked={picked}
          dialog={dialog}
          onOpenSession={onOpenSession}
        />
      </main>
    </div>
  );
}

/**
 * One column, prompts answered in place (E-NeedsYou). On a table it
 * splits around the fold where it crosses the page: the list above, the
 * picked prompt or agent on the base, where its buttons are in reach and
 * clear of the fold.
 */
function OneColumn({
  pageRef,
  list,
  view,
  title,
  quiet,
  onOpenSession,
}: {
  pageRef: RefObject<HTMLElement | null>;
  list: NeedsYouList;
  view: ViewProps;
  title: ReactNode;
  quiet: boolean;
  onOpenSession: (session: Session) => void;
}) {
  const mode = useLayoutMode();
  const picked = usePicked(list, view);
  // A page on any width: the phone's sheet needs a list of agents to host
  // it, which this may not have
  const openAgent = (agent: BackgroundAgent) =>
    openPage({ kind: "agent", agentId: agent.id });

  return (
    <FoldSplit
      el={pageRef}
      className="flex-1"
      top={
        <PickList
          list={list}
          view={view}
          picked={picked}
          title={title}
          quiet={quiet}
          onOpenSession={onOpenSession}
          className={cn(PAD.tabletop, "pb-2")}
        />
      }
      base={
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mt-auto">
            {picked.session ? (
              <AskCard
                key={picked.session.id}
                session={picked.session}
                title={displayTitle(picked.session, list.titles).title}
                projectName={
                  list.waiting.find(
                    (w) =>
                      w.kind === "session" &&
                      w.session.id === picked.session!.id
                  )?.projectName
                }
                onOpen={() => onOpenSession(picked.session!)}
              />
            ) : picked.agent ? (
              <BlockedCard
                agent={picked.agent}
                projectName={
                  list.waiting.find(
                    (w) => w.kind === "agent" && w.agent.id === picked.agent!.id
                  )?.projectName ?? folderName(picked.agent.cwd)
                }
                onOpen={() => openAgent(picked.agent!)}
              />
            ) : null}
          </div>
        </div>
      }
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-[calc(1.5rem+var(--home-pad-b,0px)+env(safe-area-inset-bottom))]",
          PAD[mode]
        )}
      >
        {title}
        {list.waiting.length === 0 && <NothingNeedsYou quiet={quiet} />}
        {list.waiting.map((w, i) =>
          w.kind === "session" ? (
            <AskCard
              key={w.session.id}
              session={w.session}
              title={displayTitle(w.session, list.titles).title}
              projectName={w.projectName}
              pollMs={pollFor(i)}
              onOpen={() => onOpenSession(w.session)}
            />
          ) : (
            <BlockedCard
              key={w.agent.id}
              agent={w.agent}
              projectName={w.projectName}
              onOpen={() => openAgent(w.agent)}
            />
          )
        )}
        <History
          list={list}
          sessions={view.sessions}
          onOpenSession={onOpenSession}
          onOpenAgent={openAgent}
        />
      </div>
    </FoldSplit>
  );
}

/** Everything waiting on you as a page: phones, the Duo and the iOS app */
export function NeedsYouPage({ view, onOpenSession }: PageProps<"inbox">) {
  return (
    <NeedsYou view={view} onOpenSession={onOpenSession} onClose={backPage} />
  );
}

/** The same on the desktop web, as a two-column dialog */
export function NeedsYouDialog({
  view,
  onOpenSession,
}: {
  view: ViewProps;
  onOpenSession: (session: Session) => void;
}) {
  const { inboxOpen } = useSnapshot(mobileNavStore);
  const close = () => mobileNavActions.setInboxOpen(false);

  // Open in terminal runs in the pane behind it
  useEffect(() => {
    if (!inboxOpen) return;
    const onAttach = () => mobileNavActions.setInboxOpen(false);
    window.addEventListener("agentos-attach-background", onAttach);
    return () =>
      window.removeEventListener("agentos-attach-background", onAttach);
  }, [inboxOpen]);

  return (
    <Dialog open={inboxOpen} onOpenChange={mobileNavActions.setInboxOpen}>
      <DialogContent className="flex h-[min(85dvh,760px)] flex-col gap-0 overflow-hidden rounded-[22px] p-0 sm:max-w-4xl">
        {inboxOpen && (
          <NeedsYou
            view={view}
            dialog
            onClose={close}
            onOpenSession={(session) => {
              close();
              onOpenSession(session);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where it is a page: the column's Needs you (mobileNavStore.inboxOpen)
 * opens it, and inboxOpen then follows whether it shows, for the column.
 * Elsewhere an open one hands over to the dialog.
 */
export function useNeedsYouPage(enabled: boolean) {
  const { inboxOpen } = useSnapshot(mobileNavStore);
  const { page } = useSnapshot(workspacePageStore);
  const kind = page?.kind;

  useEffect(() => {
    if (enabled && inboxOpen && workspacePageStore.page?.kind !== "inbox")
      openPage({ kind: "inbox" });
  }, [enabled, inboxOpen]);

  useEffect(() => {
    if (enabled) mobileNavStore.inboxOpen = kind === "inbox";
    // Where it's a dialog (the web unfolded past the phone width), the page
    // gives way to it: inboxOpen stays, so the dialog opens instead
    else if (kind === "inbox") backPage();
  }, [enabled, kind]);
}
