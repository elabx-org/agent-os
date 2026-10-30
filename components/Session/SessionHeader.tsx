"use client";

import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  STATE_DOT_CLASS,
  STATE_WORD,
  type AgentState,
} from "@/lib/agent-state";
import { useSnapshot } from "valtio";
import { runNav } from "@/lib/nav-actions";
import { canonicalViewMode } from "@/lib/agent-views";
import { mobileNavStore, type PaneViewMode } from "@/stores/mobileNav";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { PlanChip } from "@/components/Chat/PlanChip";
import { useSessionActivity } from "@/hooks/useSessionActivity";
import { openLiveSheet, StatusCardButton } from "./ActivityStrip";
import { canSwitch, ModelChip } from "./ModelChip";
import { PermissionChip } from "./PermissionChip";
import { PrChip } from "@/components/a/PrChip";
import { isEnded, sessionPr, wantsSettleChip } from "@/lib/settle-types";
import { useSettleActions } from "./settle-action";
import { formatAge, workingLine } from "./activity-format";
import { useBackLabel } from "@/components/ControlColumn/columnState";

/** What every header says about the session */
export interface HeaderInfo {
  session: Session;
  title: string;
  /** The project's name, none for Uncategorized */
  project: string | null;
  state: AgentState;
}

/** The crumb's state word: an idle session is Ready, as in the mocks */
export function crumbState(state: AgentState): { word: string; cls: string } {
  switch (state) {
    case "needs":
      return { word: "Needs you", cls: "text-amber-600 dark:text-needs" };
    case "work":
      return { word: "Working", cls: "text-emerald-600 dark:text-work" };
    case "idle":
    case "done":
      return { word: "Ready", cls: "text-emerald-600 dark:text-work" };
    default:
      return { word: STATE_WORD[state], cls: "text-muted-foreground" };
  }
}

/**
 * "agent-os · Claude · main · Needs you"; `state: false` drops the word,
 * `agent: false` the agent (the model chip beside it names it)
 */
export function Crumb({
  info,
  extra = [],
  state = true,
  agent = true,
  className,
}: {
  info: HeaderInfo;
  extra?: (string | null | undefined)[];
  state?: boolean;
  agent?: boolean;
  className?: string;
}) {
  const parts = [
    info.project,
    agent ? agentName(info.session.agent_type) : null,
    ...extra,
  ]
    .filter(Boolean)
    .join(" · ");
  const { word, cls } = crumbState(info.state);
  return (
    <span className={cn("text-muted-foreground min-w-0 truncate", className)}>
      {parts}
      {state && (
        <>
          {" · "}
          <span className={cls}>{word}</span>
        </>
      )}
    </span>
  );
}

/** The header's "Agent and model" chip and whether its sheet is up (M4) */
export interface SwitchChipState {
  open: boolean;
  onOpen: () => void;
}

/**
 * The title in the page. `title` (Closed-Chat, N-Queue): the agent's
 * letter, "agent-os · Claude · Needs you", the 22px title, and under it the
 * plan, or while it works what it's doing; both open the Live activity.
 * `compact` (Closed-Terminal): the crumb and a 17px title, the terminal
 * gets the room. `large` (Open-Changes, the open Duo's page): the 22px
 * title alone; the activity strip under it has the rest. With `switcher`
 * (N-Switch), `title` and `large` lead with the "Claude · Opus 5.5" chip
 * in place of the letter and the agent's name
 */
export function PageHeader({
  info,
  size = "title",
  switcher,
  className,
}: {
  info: HeaderInfo;
  size?: "title" | "compact" | "large";
  switcher?: SwitchChipState;
  className?: string;
}) {
  const { session } = info;
  const cards = size === "title";
  const chip = !!switcher && size !== "compact" && canSwitch(session);
  const activity = useSessionActivity(session, {
    active: cards,
    plan: cards,
  });
  const { plan, now, state } = activity;
  // N-Settle: its PR under the title; merged and still running, Settle
  const pr = size !== "compact" ? sessionPr(session) : null;
  const { settle } = useSettleActions();
  return (
    <header
      className={cn(
        "native-top-inset kb-compact-hide bg-background flex shrink-0 flex-col pt-4 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(1.25rem+env(safe-area-inset-left))]",
        size === "compact" && "pb-1",
        // In line with the chat's 24px on the open Duo
        size === "large" && "pl-[calc(1.5rem+env(safe-area-inset-left))]",
        className
      )}
    >
      {chip && switcher ? (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <ModelChip
            session={session}
            open={switcher.open}
            onOpen={switcher.onOpen}
          />
          <Crumb
            info={info}
            agent={false}
            state={!cards || state !== "work"}
            className="shrink-[2]"
          />
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {cards && (
            <Avatar
              {...agentAvatar(session.agent_type)}
              size="sm"
              className="h-5 w-5 rounded-md text-[10px]"
            />
          )}
          {/* Working is said by the card below */}
          <Crumb info={info} state={!cards || state !== "work"} />
        </div>
      )}
      {/* N-PermMode: the shield chip at the title's right, 10px from it */}
      <div
        className={cn(
          "flex min-w-0 items-center gap-2.5",
          size === "compact" ? "mt-0.5" : chip ? "mt-2" : "mt-1"
        )}
      >
        <h1
          className={cn(
            "min-w-0 flex-1 truncate",
            size === "compact" ? "t-head leading-tight" : "t-title"
          )}
        >
          {info.title}
        </h1>
        {/* Handed off or settled: no running agent to set a mode on */}
        {!isEnded(session) && (
          <PermissionChip
            session={session}
            variant="header"
            // The terminal gets the room: a 28px chip that takes a 44px tap
            className={cn(
              size === "compact" &&
                "relative -my-1 h-7 rounded-full px-2.5 text-xs after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
            )}
          />
        )}
      </div>
      {pr && (
        <PrChip
          pr={pr}
          baseBranch={session.base_branch}
          onSettle={
            wantsSettleChip(session)
              ? () => void settle(session, info.title)
              : undefined
          }
          className="mt-2 self-start"
        />
      )}
      {cards && plan && plan.total > 0 ? (
        <PlanChip plan={plan} onOpen={openLiveSheet} className="mt-2.5" />
      ) : (
        cards &&
        state === "work" && (
          <StatusCardButton
            state={state}
            onOpen={openLiveSheet}
            className="mt-2.5"
            label={
              <>
                <span className="dark:text-work font-semibold text-emerald-600">
                  Working
                </span>
                {now.label !== "Working" && ` · ${workingLine(now)}`}
              </>
            }
            right={
              now.startedAt !== undefined
                ? formatAge(Date.now() - now.startedAt)
                : undefined
            }
          />
        )
      )}
    </header>
  );
}

/** Chat | Terminal (and more) as a segmented control */
export function ViewSeg({
  viewMode,
  onViewModeChange,
  views,
  className,
}: {
  viewMode: PaneViewMode;
  onViewModeChange: (mode: PaneViewMode) => void;
  views: { mode: PaneViewMode; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="View"
      className={cn("seg shrink-0", className)}
    >
      {views.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={viewMode === mode}
          // A box keeps its focus, so the keyboard doesn't drop first
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onViewModeChange(mode)}
          className="hover:text-foreground flex items-center gap-1.5"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const CHAT_TERMINAL: { mode: PaneViewMode; label: ReactNode }[] = [
  { mode: "chat", label: "Chat" },
  { mode: "terminal", label: "Terminal" },
];

/**
 * Half folded (Fold-Chat, Fold-Terminal): a back circle, the title in a
 * glass pill with its crumb, and Chat | Terminal on the right
 */
export function FoldHeader({
  info,
  viewMode,
  onViewModeChange,
  menu,
}: {
  info: HeaderInfo;
  viewMode: PaneViewMode;
  onViewModeChange: (mode: PaneViewMode) => void;
  /** ⋯, for the rarer views and actions */
  menu?: ReactNode;
}) {
  const agentsView = canonicalViewMode(viewMode) === "agents";
  const backLabel = useBackLabel();
  return (
    <header className="native-top-inset kb-compact-hide bg-background flex shrink-0 items-center gap-2.5 px-5 pt-4 pb-2">
      <button
        type="button"
        onClick={() => runNav("back")}
        aria-label={backLabel}
        className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      >
        <ChevronLeft aria-hidden className="h-5 w-5" strokeWidth={2.3} />
      </button>
      <div className="glass flex h-11 min-w-0 flex-col justify-center rounded-[22px] px-4">
        <span className="truncate text-[15px] leading-tight font-semibold">
          {info.title}
        </span>
        <Crumb info={info} className="text-xs leading-tight" />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* The agents view shows as the third, selected segment */}
        <ViewSeg
          viewMode={agentsView ? "agents" : viewMode}
          onViewModeChange={onViewModeChange}
          views={
            agentsView
              ? [...CHAT_TERMINAL, { mode: "agents", label: "Agents" }]
              : CHAT_TERMINAL
          }
          className="glass"
        />
        {menu}
      </div>
    </header>
  );
}

/** "1 agent", "7 agents" */
export function agentsLabel(count: number): string {
  return count === 1 ? "1 agent" : `${count} agents`;
}

/**
 * The desktop session header (Desk-Chat, D-Tree): the agent's tile, the
 * title and "agent-os · Claude · main · 7 agents · Needs you", the views
 * (Chat | Terminal | Changes, and Agents once it has started any), then
 * `actions` (Open beside, ⋯)
 */
export function DesktopHeader({
  info,
  branch,
  added,
  viewMode,
  onViewModeChange,
  dimmed,
  agents,
  actions,
}: {
  info: HeaderInfo;
  branch?: string | null;
  /** Lines added in the folder: Changes +59 */
  added: number;
  viewMode: PaneViewMode;
  onViewModeChange: (mode: PaneViewMode) => void;
  dimmed?: boolean;
  /**
   * The session's agents still at work, asking or queued; by default the
   * focused session's (the desktop header is the one pane's)
   */
  agents?: number;
  actions: ReactNode;
}) {
  const { agentLive } = useSnapshot(mobileNavStore);
  const count = agents ?? agentLive;
  const agentsView = canonicalViewMode(viewMode) === "agents";
  return (
    <header
      className={cn(
        "kb-compact-hide border-hair bg-background/70 @container/bar flex h-16 shrink-0 items-center gap-3.5 border-b px-6 backdrop-blur-xl",
        dimmed && "opacity-70"
      )}
    >
      <Avatar {...agentAvatar(info.session.agent_type)} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="t-head truncate leading-tight">{info.title}</span>
        <Crumb
          info={info}
          extra={[branch, count > 0 ? agentsLabel(count) : null]}
          className="text-[13px]"
        />
      </div>
      <ViewSeg
        // `workers` is the agents view too
        viewMode={agentsView ? "agents" : viewMode}
        onViewModeChange={onViewModeChange}
        className="bg-card @max-[640px]/bar:hidden"
        views={[
          ...CHAT_TERMINAL,
          {
            mode: "git",
            label: (
              <>
                Changes
                {added > 0 && <span className="n-add text-xs">+{added}</span>}
              </>
            ),
          },
          // D-Tree: Agents once the session has started any
          ...(count > 0 || agentsView
            ? [{ mode: "agents" as const, label: "Agents" }]
            : []),
        ]}
      />
      {actions}
    </header>
  );
}

/**
 * A pane's card header when sessions sit side by side (Desk-Beside): its
 * state dot, title and crumb, Chat | Terminal, ⋯ and ×
 */
export function PaneCardHeader({
  info,
  viewMode,
  onViewModeChange,
  menu,
  onClose,
}: {
  info: HeaderInfo;
  viewMode: PaneViewMode;
  onViewModeChange: (mode: PaneViewMode) => void;
  menu?: ReactNode;
  onClose?: () => void;
}) {
  const { state, since } = useSessionActivity(info.session, { active: false });
  return (
    <header
      data-pane-card
      className="kb-compact-hide border-hair flex h-14 shrink-0 items-center gap-2.5 border-b px-3.5"
    >
      <span
        aria-hidden
        className={cn("h-2 w-2 shrink-0 rounded-full", STATE_DOT_CLASS[state])}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] leading-tight font-semibold">
          {info.title}
        </span>
        <Crumb
          info={info}
          state={false}
          extra={[state === "work" ? formatAge(Date.now() - since) : null]}
          className="text-[13px] leading-tight"
        />
      </div>
      <ViewSeg
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        views={CHAT_TERMINAL}
        className="bg-card"
      />
      {menu}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close pane"
          className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      )}
    </header>
  );
}
