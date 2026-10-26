"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useSnapshot } from "valtio";
import { Bell, ChevronLeft, Inbox as InboxIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { InboxItem } from "@/components/Inbox";
import {
  AgentRow,
  SectionHeader,
  type RowKind,
} from "@/components/rows/AgentRow";
import {
  BackgroundAgentRow,
  home,
  openBackgroundAgent,
  useBackgroundAgentsByProject,
} from "@/components/BackgroundAgents";
import {
  AgentCrumb,
  AgentDetail,
} from "@/components/BackgroundAgents/AgentDetail";
import { PageHeader, type PageProps } from "@/components/WorkspacePage";
import { FoldSplit } from "@/components/FoldSplit";
import {
  useSpreadFold,
  type SpreadFold,
} from "@/components/views/SessionSpread";
import type { ViewProps } from "@/components/views/types";
import { useNeedsYou, type NotificationEntry } from "@/hooks/useNeedsYou";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { FOLD_CLEAR } from "@/hooks/useHinge";
import { timeAgo, type AgentState } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { openSettings } from "@/stores/settingsPage";
import { backPage, openPage, workspacePageStore } from "@/stores/workspacePage";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { Session } from "@/lib/db";

/** Opening the page marks what it shows as read, once it has been seen */
const MARK_READ_MS = 2000;
/** History kept below what needs you now */
const EARLIER_MAX = 50;
/** Narrower than this a page lists everything in one column */
const SPLIT_MIN_WIDTH = 720;

type Picked = { kind: "session" | "agent"; id: string };

interface Group {
  key: string;
  name: string;
  sessions: Session[];
  agents: BackgroundAgent[];
}

/** The last folder of a path, for things outside every project */
function folderName(dir: string): string {
  return home(dir).replace(/\/+$/, "").split("/").pop() || dir;
}

/**
 * What the page lists: waiting sessions and blocked agents grouped by
 * project, the history split into what finished since you last looked and
 * the rest, and whether it has been seen (marked read after a moment).
 */
function useNeedsYouList(view: ViewProps) {
  const { sessions, sessionStatuses, projects } = view;
  const needs = useNeedsYou(sessions, sessionStatuses);
  const titles = useListTitles(needs.waiting);
  const agentsByProject = useBackgroundAgentsByProject(projects);
  const { history, unread, markRead } = needs;

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
    groups,
    titles,
    agents: needs.agents,
    finished,
    earlier,
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

// "fusionha · 4 background agents"
function groupLabel(group: Group): string {
  const n = group.agents.length;
  return n
    ? `${group.name} · ${n} background agent${n === 1 ? "" : "s"}`
    : group.name;
}

/** "ntfy · sent", from what each channel did */
function channels(entry: NotificationEntry): string | null {
  const { ntfy, apns } = entry.delivered ?? {};
  const parts = [
    ntfy && `ntfy · ${ntfy === "sent" ? "sent" : "failed"}`,
    apns && `Apple push · ${/\bsent\b/.test(apns) ? "sent" : "failed"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const ENTRY_STATE: Record<NotificationEntry["kind"], AgentState> = {
  needsYou: "needs",
  agentNeedsYou: "needs",
  finished: "done",
  agentFinished: "done",
  test: "idle",
};

/** One line of history: what happened, when, and where it was sent */
function HistoryRow({
  entry,
  onOpen,
}: {
  entry: NotificationEntry;
  /** Left out when what it was about is gone */
  onOpen?: () => void;
}) {
  const kind: RowKind = entry.agentId
    ? "background"
    : entry.sessionId
      ? "session"
      : "setting";
  return (
    <AgentRow
      as={onOpen ? "button" : "div"}
      kind={kind}
      icon={kind === "setting" ? Bell : undefined}
      state={ENTRY_STATE[entry.kind] ?? "idle"}
      title={entry.title}
      subtitle={[entry.body, timeAgo(entry.at), channels(entry)]
        .filter(Boolean)
        .join(" · ")}
      dense
      onClick={onOpen}
    />
  );
}

function History({
  list,
  sessions,
  onOpenSession,
  onOpenAgent,
}: {
  list: NeedsYouList;
  sessions: Session[];
  onOpenSession: (session: Session) => void;
  onOpenAgent: (agent: BackgroundAgent) => void;
}) {
  const open = (entry: NotificationEntry) => {
    if (entry.agentId) {
      const agent = list.agents.find((a) => a.id === entry.agentId);
      return agent && (() => onOpenAgent(agent));
    }
    const session = sessions.find((s) => s.id === entry.sessionId);
    return session && (() => onOpenSession(session));
  };
  return (
    <>
      {list.finished.length > 0 && (
        <section>
          <SectionHeader count={list.finished.length}>Finished</SectionHeader>
          {list.finished.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} onOpen={open(entry)} />
          ))}
        </section>
      )}
      {list.earlier.length > 0 && (
        <section>
          <SectionHeader>Earlier</SectionHeader>
          {list.earlier.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} onOpen={open(entry)} />
          ))}
        </section>
      )}
    </>
  );
}

/** With nothing waiting: never a lone "All clear", the history follows */
function NothingNeedsYou({ quiet }: { quiet: boolean }) {
  return (
    <div className="px-2 pt-4 pb-2">
      <p className="text-sm font-medium">Nothing needs you</p>
      <p className="text-muted-foreground text-[12.5px]">
        {quiet
          ? "Sessions waiting on you, and background agents that ask or finish, show up here."
          : "What happened lately is below."}
      </p>
    </div>
  );
}

function SettingsLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground mx-2 mt-4 mb-2 flex min-h-[44px] items-center gap-2 text-[13px]"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      Notification settings
    </button>
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

  const onSettings = () => {
    onClose();
    openSettings("notifications");
  };
  const quiet = !list.count && !list.finished.length && !list.earlier.length;
  const count = list.count > 0 && (
    <span className="text-muted-foreground text-[12.5px] tabular-nums">
      {list.count}
    </span>
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
          count={count}
          quiet={quiet}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onSettings={onSettings}
        />
      ) : (
        <OneColumn
          pageRef={ref}
          list={list}
          view={view}
          count={count}
          quiet={quiet}
          onOpenSession={onOpenSession}
          onSettings={onSettings}
        />
      )}
    </div>
  );
}

function Title({ dialog }: { dialog?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <InboxIcon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
      {dialog ? (
        <DialogTitle asChild>
          <span>Needs you</span>
        </DialogTitle>
      ) : (
        "Needs you"
      )}
    </span>
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
      ? list.groups.some((g) => g.sessions.some((s) => s.id === p.id))
      : // An agent may be picked from the history while it exists
        list.agents.some((a) => a.id === p.id);
  const first = list.groups[0];
  const current: Picked | null =
    picked && isItem(picked)
      ? picked
      : first?.sessions[0]
        ? { kind: "session", id: first.sessions[0].id }
        : first?.agents[0]
          ? { kind: "agent", id: first.agents[0].id }
          : null;

  return {
    isPicked: (kind: Picked["kind"], id: string) =>
      current?.kind === kind && current.id === id,
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

/** The list as rows to pick from: the detail shows the picked one */
function PickList({
  list,
  view,
  picked,
  quiet,
  onOpenSession,
  onSettings,
  className,
}: {
  list: NeedsYouList;
  view: ViewProps;
  picked: PickedItem;
  quiet: boolean;
  onOpenSession: (session: Session) => void;
  onSettings: () => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Needs you"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain",
        className
      )}
    >
      {list.groups.length === 0 && <NothingNeedsYou quiet={quiet} />}
      {list.groups.map((group) => (
        <section key={group.key}>
          <SectionHeader>{groupLabel(group)}</SectionHeader>
          {group.sessions.map((s) => {
            const { title, idLabel } = displayTitle(s, list.titles);
            return (
              <AgentRow
                key={s.id}
                kind="session"
                state="needs"
                title={title}
                idLabel={idLabel}
                detail={timeAgo(s.updated_at)}
                selected={picked.isPicked("session", s.id)}
                onClick={() => picked.pick({ kind: "session", id: s.id })}
              />
            );
          })}
          {group.agents.map((a) => (
            <AgentRow
              key={a.id}
              kind="background"
              state="needs"
              title={a.name}
              // 0 means the state file didn't say
              detail={
                a.startedAt
                  ? `started ${timeAgo(a.startedAt, { dateAfterDays: Infinity })}`
                  : undefined
              }
              dense
              selected={picked.isPicked("agent", a.id)}
              onClick={() => picked.pick({ kind: "agent", id: a.id })}
            />
          ))}
        </section>
      ))}
      <History
        list={list}
        sessions={view.sessions}
        onOpenSession={onOpenSession}
        onOpenAgent={(a) => picked.pick({ kind: "agent", id: a.id })}
      />
      <SettingsLink onClick={onSettings} />
    </nav>
  );
}

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
  if (session)
    return (
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
          // Clear of the dialog's close button
          dialog && "pt-12"
        )}
      >
        <InboxItem
          as="div"
          session={session}
          title={displayTitle(session, list.titles).title}
          projectName={
            list.groups.find((g) => g.sessions.includes(session))?.name
          }
          onOpen={() => onOpenSession(session)}
        />
      </div>
    );
  if (agent)
    return (
      <>
        <header
          className={cn(
            "border-border flex min-h-[50px] shrink-0 flex-col justify-center border-b px-4 pt-2 pb-2",
            // Clear of the dialog's close button
            dialog && "pr-14"
          )}
        >
          <h2 className="truncate text-[15px] font-semibold">{agent.name}</h2>
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            <AgentCrumb agent={agent} />
          </p>
        </header>
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

/** The list on the left (page), the picked prompt or agent on the right */
function SplitLayout({
  list,
  view,
  split,
  dialog,
  count,
  quiet,
  onOpenSession,
  onClose,
  onSettings,
}: {
  list: NeedsYouList;
  view: ViewProps;
  split: Split;
  dialog?: boolean;
  count: ReactNode;
  quiet: boolean;
  onOpenSession: (session: Session) => void;
  onClose: () => void;
  onSettings: () => void;
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
        <header className="flex min-h-[50px] shrink-0 items-center gap-2 px-3 pt-2 pb-2">
          {!dialog && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="text-muted-foreground active:bg-accent hover:bg-accent relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg after:absolute after:-inset-[5px] after:content-['']"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            <Title dialog={dialog} />
          </div>
          {count}
        </header>
        {dialog && (
          <DialogDescription className="sr-only">
            {list.count ? `${list.count} waiting on you` : "Nothing needs you"}
          </DialogDescription>
        )}
        <PickList
          list={list}
          view={view}
          picked={picked}
          quiet={quiet}
          onOpenSession={onOpenSession}
          onSettings={onSettings}
          className="px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
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
 * One column, prompts answered in place. On a table it splits around the
 * fold where it crosses the page: the list above, the picked prompt or agent
 * on the base, where its buttons are in reach and clear of the fold.
 */
function OneColumn({
  pageRef,
  list,
  view,
  count,
  quiet,
  onOpenSession,
  onSettings,
}: {
  pageRef: RefObject<HTMLElement | null>;
  list: NeedsYouList;
  view: ViewProps;
  count: ReactNode;
  quiet: boolean;
  onOpenSession: (session: Session) => void;
  onSettings: () => void;
}) {
  const picked = usePicked(list, view);

  return (
    <FoldSplit
      el={pageRef}
      className="flex-1"
      top={
        <>
          <PageHeader title={<Title />} actions={count} />
          <PickList
            list={list}
            view={view}
            picked={picked}
            quiet={quiet}
            onOpenSession={onOpenSession}
            onSettings={onSettings}
            className="px-3 pb-2"
          />
        </>
      }
      base={
        <div className="border-border flex min-h-0 flex-1 flex-col border-t">
          <PickedDetail
            list={list}
            picked={picked}
            onOpenSession={onOpenSession}
          />
        </div>
      }
    >
      <PageHeader title={<Title />} actions={count} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {list.groups.length === 0 && <NothingNeedsYou quiet={quiet} />}
        {list.groups.map((group) => (
          <section key={group.key}>
            <SectionHeader>{groupLabel(group)}</SectionHeader>
            {group.sessions.length > 0 && (
              <ul className="mb-2 space-y-2.5">
                {group.sessions.map((session) => (
                  <InboxItem
                    key={session.id}
                    session={session}
                    title={displayTitle(session, list.titles).title}
                    onOpen={() => onOpenSession(session)}
                  />
                ))}
              </ul>
            )}
            {group.agents.map((agent) => (
              <BackgroundAgentRow key={agent.id} agent={agent} noId dense />
            ))}
          </section>
        ))}
        <History
          list={list}
          sessions={view.sessions}
          onOpenSession={onOpenSession}
          // A page on any width: the phone's sheet needs a list of
          // agents to host it, which this may not have
          onOpenAgent={(agent) =>
            openPage({ kind: "agent", agentId: agent.id })
          }
        />
        <SettingsLink onClick={onSettings} />
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
      <DialogContent className="flex h-[min(85dvh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
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
 * opens it, and inboxOpen then follows whether it shows, for the column
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
  }, [enabled, kind]);
}
