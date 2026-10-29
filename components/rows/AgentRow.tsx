"use client";

import {
  forwardRef,
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import {
  Bot,
  ChevronRight,
  Folder,
  GitCompare,
  GitFork,
  Server,
  Settings,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STATE_BADGE_CLASS,
  STATE_TEXT_CLASS,
  STATE_WORD,
  type AgentState,
} from "@/lib/agent-state";

export type RowKind =
  | "session"
  | "background"
  | "subagent"
  | "dev"
  | "project"
  | "changes"
  | "setting";

type Icon = ComponentType<{ className?: string; size?: number }>;

const KIND_ICON: Record<Exclude<RowKind, "setting">, Icon> = {
  session: SquareTerminal,
  background: Bot,
  subagent: GitFork,
  dev: Server,
  project: Folder,
  changes: GitCompare,
};

/** The kind icon on a tile tinted by state */
export function KindBadge({
  kind,
  state = "idle",
  icon,
  className,
}: {
  kind: RowKind;
  state?: AgentState;
  /** Overrides the kind's icon; settings rows bring their own */
  icon?: Icon;
  className?: string;
}) {
  const Glyph = icon ?? (kind === "setting" ? Settings : KIND_ICON[kind]);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]",
        STATE_BADGE_CLASS[state],
        className
      )}
    >
      <Glyph size={15} />
    </span>
  );
}

export function StateWord({
  state,
  className,
}: {
  state: AgentState;
  className?: string;
}) {
  return (
    <span className={cn(STATE_TEXT_CLASS[state], className)}>
      {STATE_WORD[state]}
    </span>
  );
}

export interface AgentRowProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  kind: RowKind;
  state: AgentState;
  title: ReactNode;
  /** Small dim text after the title, e.g. "Session 24" */
  idLabel?: ReactNode;
  /** Left out inside a list already scoped to one project */
  project?: ReactNode;
  /** Time or what it's doing, last in the subtitle */
  detail?: ReactNode;
  /** Replaces the default "<state> · project · detail"; null hides it */
  subtitle?: ReactNode;
  /** Chevron, button or kbd hint; keep it interactive only with as="div" */
  trailing?: ReactNode;
  /** Small marks after the title (unread, pinned...) */
  badges?: ReactNode;
  icon?: Icon;
  selected?: boolean;
  dense?: boolean;
  /** "div" when the row holds its own buttons, which can't nest in one */
  as?: "button" | "div";
  disabled?: boolean;
}

/**
 * The one row every list uses: kind badge, title, then the state word ·
 * project · detail. Spreads the rest of its props on the root so SwipeRow,
 * ContextMenuTrigger asChild and long-press handlers attach to it.
 */
export const AgentRow = forwardRef<HTMLElement, AgentRowProps>(
  function AgentRow(
    {
      kind,
      state,
      title,
      idLabel,
      project,
      detail,
      subtitle,
      trailing,
      badges,
      icon,
      selected,
      dense,
      as = "button",
      disabled,
      className,
      ...rest
    },
    ref
  ) {
    const sub =
      subtitle !== undefined ? (
        subtitle
      ) : (
        <>
          <StateWord state={state} />
          {project ? <> · {project}</> : null}
          {detail ? <> · {detail}</> : null}
        </>
      );

    const body = (
      <>
        <KindBadge kind={kind} state={state} icon={icon} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[14.5px]">
              {title}
              {idLabel ? (
                <small className="text-muted-foreground/70 ml-1.5 text-xs">
                  {idLabel}
                </small>
              ) : null}
            </span>
            {badges}
          </span>
          {sub !== null && (
            <span className="text-muted-foreground block truncate text-[12.5px]">
              {sub}
            </span>
          )}
        </span>
        {trailing != null && (
          <span className="flex shrink-0 items-center">{trailing}</span>
        )}
      </>
    );

    const classes = cn(
      "flex w-full items-center gap-3 rounded-xl px-2 py-[7px] text-left",
      dense ? "min-h-[46px]" : "min-h-[54px]",
      selected
        ? "bg-[var(--row-sel)]"
        : "[@media(pointer:fine)]:hover:bg-accent/50",
      "active:bg-accent disabled:opacity-50",
      className
    );

    if (as === "div")
      return (
        <div
          ref={ref as Ref<HTMLDivElement>}
          aria-disabled={disabled || undefined}
          className={classes}
          {...rest}
        >
          {body}
        </div>
      );
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        disabled={disabled}
        aria-current={selected || undefined}
        className={classes}
        {...rest}
      >
        {body}
      </button>
    );
  }
);

/**
 * A group that opens in place, e.g. "FusionHA · 4 background agents" with
 * "4 need you · fusionha" under it; open, its rows sit indented beneath.
 */
export function FoldedRow({
  kind = "background",
  state,
  title,
  summary,
  open,
  onToggle,
  selected,
  dense,
  className,
  children,
}: {
  kind?: RowKind;
  state: AgentState;
  title: ReactNode;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  selected?: boolean;
  dense?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      <AgentRow
        kind={kind}
        state={state}
        title={title}
        subtitle={summary}
        selected={selected}
        dense={dense}
        aria-expanded={open}
        onClick={onToggle}
        trailing={
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "text-muted-foreground h-4 w-4 transition-transform",
              open && "rotate-90"
            )}
          />
        }
      />
      {/* Lines the children's badges up under the group's title */}
      {open && <div className="ml-[42px]">{children}</div>}
    </div>
  );
}

export interface ProjectCounts {
  agents: number;
  needs?: number;
  work?: number;
}

/** A project in a list: folder badge in its busiest state, counts in words */
export const ProjectRow = forwardRef<
  HTMLElement,
  Omit<AgentRowProps, "kind" | "state" | "title" | "subtitle"> & {
    name: ReactNode;
    counts?: ProjectCounts;
    /** Defaults to needs > work > idle from the counts */
    state?: AgentState;
    nosub?: boolean;
  }
>(function ProjectRow(
  { name, counts, state, nosub, dense = true, trailing, ...rest },
  ref
) {
  const needs = counts?.needs ?? 0;
  const work = counts?.work ?? 0;
  const subtitle =
    nosub || !counts ? null : (
      <>
        {counts.agents} agent{counts.agents === 1 ? "" : "s"}
        {needs > 0 && (
          <>
            {" · "}
            <span className={STATE_TEXT_CLASS.needs}>
              {needs} need{needs === 1 ? "s" : ""} you
            </span>
          </>
        )}
        {work > 0 && (
          <>
            {" · "}
            <span className={STATE_TEXT_CLASS.work}>{work} working</span>
          </>
        )}
      </>
    );
  return (
    <AgentRow
      ref={ref}
      kind="project"
      state={state ?? (needs ? "needs" : work ? "work" : "idle")}
      title={name}
      subtitle={subtitle}
      dense={dense}
      trailing={
        trailing !== undefined ? (
          trailing
        ) : (
          <ChevronRight
            aria-hidden="true"
            className="text-muted-foreground h-4 w-4"
          />
        )
      }
      {...rest}
    />
  );
});

/** "Working · 3", with an optional link on the right like "All projects" */
export function SectionHeader({
  children,
  count,
  action,
  className,
}: {
  children: ReactNode;
  count?: number;
  action?: { label: ReactNode; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex items-center gap-2 px-2 pt-4 pb-1.5 text-[15px] font-semibold",
        className
      )}
    >
      <span className="min-w-0 truncate">
        {children}
        {count !== undefined && <> · {count}</>}
      </span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="relative ml-auto shrink-0 text-sm font-medium text-violet-700 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] active:opacity-70 dark:text-violet-300"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
