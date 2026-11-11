"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ExternalLink,
  GitPullRequest,
  Loader2,
  SquareTerminal,
} from "lucide-react";
import type { PageProps } from "@/components/WorkspacePage";
import { GroupCard, GroupRow } from "@/components/a/GroupCard";
import { shortAge } from "@/components/MissionControl/now-summary";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
import { SwipeRow } from "@/components/ui/swipe-row";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { confirmAction } from "@/components/ui/confirm";
import { PAGE_BARS } from "@/components/ControlColumn/columnState";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useLongPress } from "@/hooks/useLongPress";
import { useViewport } from "@/hooks/useViewport";
import { nativeCaps } from "@/lib/native-bridge";
import { registerPageBack, runNav } from "@/lib/nav-actions";
import { MOCK_STATUSES, type Mock, type MockStatus } from "@/lib/mock-types";
import { cn } from "@/lib/utils";
import { workspacePageStore } from "@/stores/workspacePage";
import { useChangeMocks, useMocks } from "./data";

type Filter = "all" | MockStatus | "archived";

const NAME: Record<MockStatus, string> = {
  ongoing: "Ongoing",
  approved: "Approved",
  completed: "Completed",
  rejected: "Rejected",
  abandoned: "Abandoned",
};

const PILL: Record<MockStatus, string> = {
  ongoing: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  approved: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  abandoned: "bg-foreground/10 text-muted-foreground",
};

const NO_PROJECT = "No project";

/** The list's width beside the chosen mock on the desktop */
const DESK_LIST_W = 400;

function inFilter(m: Mock, filter: Filter): boolean {
  if (filter === "archived") return m.archived;
  if (m.archived) return false;
  return filter === "all" || m.status === filter;
}

/** Why it stands where it does */
function reason(m: Mock): string {
  if (m.statusNote) return m.statusNote;
  if (m.status === "completed" && m.pr) return `Built in ${m.pr}`;
  const who =
    m.statusBy === "session"
      ? "by its session"
      : m.statusBy === "user"
        ? "by you"
        : null;
  if (m.status === "ongoing" && !who) return `Updated ${shortAge(m.updatedAt)}`;
  return who ? `Marked ${who}` : NAME[m.status];
}

function StatusPill({ status }: { status: MockStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold",
        PILL[status]
      )}
    >
      {NAME[status]}
    </span>
  );
}

/**
 * The mocks sessions published, by project, with where each one stands:
 * ongoing, completed, rejected or abandoned, or archived out of the way.
 * The closed Duo lists them and pushes the chosen one; the open Duo keeps
 * the list on the left page and the mock on the right.
 */
export function MocksPage({ page, view, onOpenSession }: PageProps<"mocks">) {
  const { data: mocks, isLoading, error } = useMocks();
  const change = useChangeMocks();
  const ref = useRef<HTMLDivElement>(null);
  const spread = useSpreadPages(ref, useSpreadFold());
  // The desktop has the room too: the list beside the chosen mock
  const desktop = useLayoutMode() === "desktop";
  const pages = spread ?? (desktop ? { left: DESK_LIST_W, gutter: 0 } : null);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);

  const only = page.sessionId;
  const sessionName = only
    ? (view.sessions.find((s) => s.id === only)?.name ?? "this session")
    : null;
  const scoped = useMemo(
    () => (mocks ?? []).filter((m) => !only || m.sessionId === only),
    [mocks, only]
  );
  const list = scoped.filter((m) => inFilter(m, filter));
  const current =
    scoped.find((m) => m.url === picked) ?? (pages ? list[0] : undefined);

  useEffect(() => {
    if (pages || !pushed) return;
    return registerPageBack("Back to Mocks", () => setPushed(false));
  }, [pages, pushed]);

  const pick = (m: Mock) => {
    setPicked(m.url);
    if (!pages) setPushed(true);
  };
  const set = (
    urls: string[],
    c: Parameters<typeof change.mutate>[0]["change"]
  ) => change.mutate({ urls, change: c });
  const openSession = (m: Mock) => {
    const session = view.sessions.find((s) => s.id === m.sessionId);
    if (session) onOpenSession(session);
  };

  const actions: RowActions = {
    setStatus: (m, status) => set([m.url], { status }),
    archive: (m, archived) => set([m.url], { archived }),
    linkPr: (m, pr) => set([m.url], { pr: pr.trim() || null }),
    openSession: view.sessions.length ? openSession : undefined,
  };

  const listView = (
    <MockList
      mocks={list}
      all={scoped}
      filter={filter}
      onFilter={setFilter}
      loading={isLoading}
      failed={!!error}
      selected={pages ? current?.url : undefined}
      sessionName={sessionName}
      onPick={pick}
      actions={actions}
      onArchiveAll={async (urls) => {
        const ok = await confirmAction({
          title: `Archive ${urls.length} abandoned ${urls.length === 1 ? "mock" : "mocks"}?`,
          message: "They move to Archived, where you can restore them.",
          confirmLabel: "Archive",
        });
        if (ok) set(urls, { archived: true });
      }}
    />
  );

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {pages ? (
        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              "flex shrink-0 flex-col",
              !spread && "border-r border-[var(--hair)]"
            )}
            style={{ width: pages.left }}
          >
            {listView}
          </aside>
          <div aria-hidden="true" style={{ width: pages.gutter }} />
          <main className="flex min-w-0 flex-1 flex-col">
            {current ? (
              <MockDetail mock={current} actions={actions} />
            ) : (
              <Quiet loading={isLoading} filtered={!!sessionName} />
            )}
          </main>
        </div>
      ) : pushed && current ? (
        <MockDetail
          mock={current}
          actions={actions}
          onBack={() => setPushed(false)}
        />
      ) : (
        listView
      )}
    </div>
  );
}

interface RowActions {
  setStatus: (m: Mock, status: MockStatus) => void;
  archive: (m: Mock, archived: boolean) => void;
  linkPr: (m: Mock, pr: string) => void;
  openSession?: (m: Mock) => void;
}

function useBackInTitle() {
  const mode = useLayoutMode();
  const native = useIsNative();
  // Where no column holds back, the title does
  return {
    mode,
    back: PAGE_BARS.includes(mode) || (native && !nativeCaps().column),
  };
}

function MockList({
  mocks,
  all,
  filter,
  onFilter,
  loading,
  failed,
  selected,
  sessionName,
  onPick,
  actions,
  onArchiveAll,
}: {
  mocks: Mock[];
  all: Mock[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  loading: boolean;
  failed: boolean;
  selected?: string;
  sessionName: string | null;
  onPick: (m: Mock) => void;
  actions: RowActions;
  onArchiveAll: (urls: string[]) => void;
}) {
  const { mode, back } = useBackInTitle();
  const groups: [string, Mock[]][] = [];
  for (const m of mocks) {
    const name = m.projectName ?? NO_PROJECT;
    const group = groups.find(([g]) => g === name);
    if (group) group[1].push(m);
    else groups.push([name, [m]]);
  }
  groups.sort(
    ([a], [b]) => Number(a === NO_PROJECT) - Number(b === NO_PROJECT)
  );
  const count = (f: Filter) => all.filter((m) => inFilter(m, f)).length;
  const chips: Filter[] = ["all", ...MOCK_STATUSES, "archived"];

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
        mode === "duo-closed" ? "pt-[18px] pr-2 pl-5" : "px-5 pt-5"
      )}
    >
      {back && (
        <button
          type="button"
          onClick={() => runNav("back")}
          aria-label="Back"
          className="text-muted-foreground active:bg-accent -ml-2 flex h-[44px] w-[44px] items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <header className="flex shrink-0 flex-col">
        <h1 className="t-large">Mocks</h1>
        {sessionName ? (
          <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-[14px]">
            <span className="min-w-0 flex-1 truncate">
              Published by {sessionName}
            </span>
            <button
              type="button"
              onClick={() => {
                workspacePageStore.page = { kind: "mocks" };
              }}
              className="text-primary active:bg-accent min-h-[44px] shrink-0 rounded-full px-3 text-[15px] font-medium"
            >
              Show all
            </button>
          </div>
        ) : (
          all.length > 0 && (
            <p className="text-muted-foreground mt-1 text-[14px]">
              {count("ongoing")} ongoing · {all.length} tracked
            </p>
          )
        )}
      </header>
      <div
        role="tablist"
        aria-label="Filter mocks"
        className="-mx-5 flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]"
      >
        {chips.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => onFilter(f)}
            className={cn(
              "flex min-h-[34px] shrink-0 items-center gap-1 rounded-full px-3 text-[14px]",
              filter === f
                ? "bg-foreground text-background font-semibold"
                : "bg-foreground/[0.07] active:bg-foreground/15"
            )}
          >
            {f === "all" ? "All" : f === "archived" ? "Archived" : NAME[f]}
            <span
              className={cn(
                "text-[13px]",
                filter === f ? "opacity-60" : "text-muted-foreground"
              )}
            >
              {count(f)}
            </span>
          </button>
        ))}
      </div>
      {filter === "abandoned" && mocks.length > 0 && (
        <div className="flex items-center justify-between px-1 text-[14px]">
          <span className="text-muted-foreground">
            No new version for a week, or dropped
          </span>
          <button
            type="button"
            onClick={() => onArchiveAll(mocks.map((m) => m.url))}
            className="text-primary active:bg-accent min-h-[44px] shrink-0 rounded-full px-3 font-medium"
          >
            Archive all
          </button>
        </div>
      )}
      {failed ? (
        <p className="text-muted-foreground text-sm">
          Couldn&apos;t list mocks.
        </p>
      ) : mocks.length ? (
        <div className="flex flex-col gap-4" aria-label="Mocks">
          {groups.map(([name, ms]) => (
            <section key={name} className="flex flex-col gap-2">
              {!sessionName && (
                <h2 className="text-muted-foreground flex justify-between px-1 text-[13px] font-semibold">
                  <span className="truncate">{name}</span>
                  <span>{ms.length}</span>
                </h2>
              )}
              <GroupCard
                aria-label={name}
                className="[&>*+*]:border-hair [&>*+*]:border-t dark:[&>*+*]:border-white/[0.06]"
              >
                {ms.map((m) => (
                  <MockRow
                    key={m.url}
                    mock={m}
                    selected={selected === m.url}
                    chevron={selected === undefined}
                    onPick={() => onPick(m)}
                    actions={actions}
                  />
                ))}
              </GroupCard>
            </section>
          ))}
        </div>
      ) : (
        <Quiet loading={loading} filtered={!!sessionName} empty={!all.length} />
      )}
    </div>
  );
}

function sheetGroups(m: Mock, actions: RowActions): SheetAction[][] {
  return [
    MOCK_STATUSES.map((status) => ({
      label: `Mark ${NAME[status].toLowerCase()}`,
      checked: m.status === status,
      onSelect: () => actions.setStatus(m, status),
    })),
    [
      {
        label: m.pr ? `PR ${m.pr}` : "Link PR",
        icon: GitPullRequest,
        prompt: {
          title: "Link PR",
          value: m.pr ?? "",
          submitLabel: "Save",
          onSubmit: (pr) => actions.linkPr(m, pr),
        },
      },
      ...(actions.openSession && m.sessionId
        ? [
            {
              label: "Open session",
              icon: SquareTerminal,
              onSelect: () => actions.openSession?.(m),
            },
          ]
        : []),
    ],
    [
      {
        label: m.archived ? "Restore" : "Archive",
        icon: m.archived ? ArchiveRestore : Archive,
        onSelect: () => actions.archive(m, !m.archived),
      },
    ],
  ];
}

/**
 * Touch: swipe right to mark it completed, left to archive, hold for the
 * rest. A mouse: right-click for the same menu.
 */
function MockRow({
  mock: m,
  selected,
  chevron,
  onPick,
  actions,
}: {
  mock: Mock;
  selected: boolean;
  chevron: boolean;
  onPick: () => void;
  actions: RowActions;
}) {
  const { isTouch } = useViewport();
  const rowRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(false);
  useLongPress(rowRef, isTouch ? () => setSheet(true) : undefined);

  const row = (
    <div ref={rowRef}>
      <GroupRow
        title={m.title}
        subtitle={[m.sessionName, `v${m.versions}`, shortAge(m.updatedAt)]
          .filter(Boolean)
          .join(" · ")}
        trailing={<StatusPill status={m.status} />}
        chevron={chevron}
        selected={selected}
        onClick={onPick}
      />
    </div>
  );

  if (isTouch) {
    return (
      <>
        <SwipeRow
          className="rounded-none"
          leading={
            m.status !== "completed"
              ? {
                  label: "Done",
                  icon: Check,
                  tone: "bg-emerald-600",
                  onAction: () => actions.setStatus(m, "completed"),
                }
              : undefined
          }
          trailing={{
            label: m.archived ? "Restore" : "Archive",
            icon: m.archived ? ArchiveRestore : Archive,
            tone: "bg-zinc-500",
            onAction: () => actions.archive(m, !m.archived),
          }}
        >
          {row}
        </SwipeRow>
        <ActionSheet
          open={sheet}
          onOpenChange={setSheet}
          title={m.title}
          description={[m.projectName, m.sessionName]
            .filter(Boolean)
            .join(" · ")}
          groups={sheetGroups(m, actions)}
        />
      </>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        {MOCK_STATUSES.map((status) => (
          <ContextMenuItem
            key={status}
            onSelect={() => actions.setStatus(m, status)}
          >
            <span className="flex-1">Mark {NAME[status].toLowerCase()}</span>
            {m.status === status && <Check className="ml-4 h-4 w-4" />}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        {actions.openSession && m.sessionId && (
          <ContextMenuItem onSelect={() => actions.openSession?.(m)}>
            Open session
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => actions.archive(m, !m.archived)}>
          {m.archived ? "Restore" : "Archive"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MockDetail({
  mock: m,
  actions,
  onBack,
}: {
  mock: Mock;
  actions: RowActions;
  onBack?: () => void;
}) {
  const { mode, back } = useBackInTitle();
  const [editingPr, setEditingPr] = useState(false);
  const [pr, setPr] = useState(m.pr ?? "");
  useEffect(() => setPr(m.pr ?? ""), [m.url, m.pr]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
        mode === "duo-closed" ? "pt-[18px] pr-2 pl-5" : "px-5 pt-5"
      )}
    >
      {onBack && back && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Mocks"
          className="text-muted-foreground active:bg-accent -ml-2 flex h-[44px] w-[44px] items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <header className="flex flex-col gap-0.5">
        <p className="text-muted-foreground truncate text-[13px]">
          {[m.projectName ?? NO_PROJECT, m.sessionName]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <h2 className="text-[24px] leading-tight font-semibold text-balance">
          {m.title}
        </h2>
        <p className="text-muted-foreground text-[13px]">
          First {shortAge(m.createdAt)} ago · last version{" "}
          {shortAge(m.updatedAt)} ago · v{m.versions}
          {m.archived && " · archived"}
        </p>
      </header>
      {m.description && <p className="text-[15px]">{m.description}</p>}

      <div
        role="radiogroup"
        aria-label="Status"
        className="bg-foreground/[0.07] grid grid-cols-4 gap-1 rounded-xl p-1"
      >
        {MOCK_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={m.status === status}
            onClick={() => actions.setStatus(m, status)}
            className={cn(
              "min-h-[36px] rounded-lg text-[13px]",
              m.status === status
                ? "bg-foreground/15 text-foreground font-semibold"
                : "text-muted-foreground active:bg-foreground/10"
            )}
          >
            {NAME[status]}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground -mt-2 px-1 text-[13px]">
        {reason(m)}
      </p>

      <GroupCard aria-label="Details">
        <GroupRow
          compact
          title="Session"
          trailing={m.sessionName ?? "Ended"}
          onClick={
            actions.openSession && m.sessionId
              ? () => actions.openSession?.(m)
              : undefined
          }
        />
        <GroupRow compact title="Versions" trailing={String(m.versions)} />
        {editingPr ? (
          <form
            className="flex items-center gap-2 px-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              actions.linkPr(m, pr);
              setEditingPr(false);
            }}
          >
            <input
              autoFocus
              value={pr}
              onChange={(e) => setPr(e.target.value)}
              placeholder="#162 or a link"
              aria-label="Linked PR"
              className="bg-foreground/[0.07] min-h-[36px] min-w-0 flex-1 rounded-lg px-3 text-[15px] outline-none"
            />
            <button
              type="submit"
              className="text-primary min-h-[36px] px-2 text-[15px] font-medium"
            >
              Save
            </button>
          </form>
        ) : (
          <GroupRow
            compact
            title="Linked PR"
            trailing={m.pr ?? "Add"}
            onClick={() => setEditingPr(true)}
          />
        )}
      </GroupCard>

      <a
        href={m.url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-primary flex min-h-[48px] items-center justify-center gap-2 rounded-2xl font-semibold text-white active:opacity-80"
      >
        <ExternalLink className="h-4 w-4" />
        Open mock
      </a>
      <button
        type="button"
        onClick={() => actions.archive(m, !m.archived)}
        className="bg-foreground/[0.07] active:bg-foreground/15 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl font-semibold"
      >
        {m.archived ? (
          <ArchiveRestore className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
        {m.archived ? "Restore" : "Archive"}
      </button>
    </div>
  );
}

function Quiet({
  loading,
  filtered,
  empty,
}: {
  loading: boolean;
  filtered?: boolean;
  empty?: boolean;
}) {
  return (
    <div className="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6 text-center text-sm">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : filtered ? (
        "This session hasn't published a mock since tracking began."
      ) : empty ? (
        "No mocks yet. Mocks sessions publish from now on show here."
      ) : (
        "Nothing here."
      )}
    </div>
  );
}
