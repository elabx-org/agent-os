"use client";

import type { ReactNode } from "react";
import { useSnapshot } from "valtio";
import { Check, ChevronRight, Clock, List, Workflow } from "lucide-react";
import type { Session } from "@/lib/db";
import type { AgentTreeResponse, TreeNode } from "@/lib/agent-tree-types";
import { cn } from "@/lib/utils";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { StateDot } from "@/components/a/StateDot";
import { agentTreeStore, toggleCollapsed } from "@/stores/agentTree";
import {
  countParts,
  nodeAge,
  nodeLabel,
  phaseLine,
  shortLine,
  shortTokens,
  shownChildren,
  workflowLine,
  type CountKey,
} from "./agent-tree-format";

const COUNT_DOT: Record<CountKey, string> = {
  asking: "bg-needs",
  working: "bg-work",
  done: "bg-meter",
  failed: "bg-red-400",
  queued: "bg-[#636366]",
};

/** The guide lines: a rail down the left of each child, an elbow into it */
function guideItem(open: boolean) {
  return cn(
    "relative",
    open ? "pt-1" : "pt-1.5",
    // The rail beside every child but the last
    "before:absolute before:top-0 before:bottom-0 before:-left-[11px] before:border-l-[1.5px] before:content-['']",
    // The elbow into the row's middle
    "after:absolute after:-left-[11px] after:w-[9px] after:border-t-[1.5px] after:content-['']",
    open ? "after:top-[28px]" : "after:top-[30px]",
    // The last child: the rail ends in a rounded corner instead
    "last:before:bottom-auto last:before:w-[9px] last:before:rounded-bl-[8px] last:before:border-b-[1.5px] last:after:hidden",
    open ? "last:before:h-[28px]" : "last:before:h-[30px]",
    "before:border-black/15 after:border-black/15 dark:before:border-white/16 dark:after:border-white/16"
  );
}

/** Done: the purple tick beside the name (N-Tree's .ok) */
function DoneMark() {
  return (
    <span
      aria-hidden
      className="bg-primary inline-flex h-4 w-4 flex-none items-center justify-center rounded-full"
    >
      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} />
    </span>
  );
}

/** A state beside the name: the tick when done, else its dot */
function StateMark({ node }: { node: TreeNode }) {
  return node.state === "done" ? <DoneMark /> : <StateDot state={node.state} />;
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="bg-foreground/8 text-muted-foreground flex-none rounded-md px-1.5 py-px text-[11px] font-semibold">
      {children}
    </span>
  );
}

function WorkflowTile() {
  return (
    <span
      aria-hidden
      className="bg-primary/18 flex h-7 w-7 flex-none items-center justify-center rounded-lg text-violet-700 dark:text-[#C4B5FD]"
    >
      <Workflow className="h-4 w-4" />
    </span>
  );
}

/** A phase's list (or clock, queued), where an avatar would sit */
function PhaseIcon({ node }: { node: TreeNode }) {
  const Icon = node.state === "queued" ? Clock : List;
  return (
    <span
      aria-hidden
      className="text-muted-foreground flex w-7 flex-none justify-center"
    >
      <Icon
        className={cn("h-4 w-4", node.state === "queued" && "opacity-80")}
      />
    </span>
  );
}

/** Folded: a chevron says there's more under it */
function Folded({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <ChevronRight
      aria-hidden
      className="text-muted-foreground h-4 w-4 flex-none"
    />
  ) : null;
}

interface RowProps {
  node: TreeNode;
  parent: TreeNode | null;
  selected: boolean;
  collapsed: boolean;
  onSelect: (node: TreeNode) => void;
  now: number;
}

/** N-Tree's card: avatar, name and state, what it does, age and tokens */
function ClosedRow({ node, parent, collapsed, onSelect, now }: RowProps) {
  const branchy = node.kind === "workflow" || node.kind === "phase";
  const asking = node.state === "needs";
  const age = nodeAge(node, now);
  const tokens = shortTokens(node.tokens);
  const label = nodeLabel(
    node,
    parent,
    node.kind === "fork" || node.kind === "handoff" || node.kind === "worker"
      ? agentName(node.agentType)
      : undefined
  );
  const onClick = () => (branchy ? toggleCollapsed(node.id) : onSelect(node));

  if (node.kind === "phase")
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-expanded={node.children.length ? !collapsed : undefined}
        className="flex min-h-12 w-full items-center gap-2.5 rounded-[14px] py-1.5 pr-2.5 pl-1 text-left"
      >
        <PhaseIcon node={node} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm font-semibold",
              node.state === "queued" && "text-muted-foreground"
            )}
          >
            {node.title}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {phaseLine(node)}
          </span>
        </span>
        <Folded collapsed={collapsed} />
      </button>
    );

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={branchy && node.children.length ? !collapsed : undefined}
      className={cn(
        "bg-card text-foreground flex w-full items-center gap-2.5 rounded-[14px] text-left",
        node.kind === "session" ? "min-h-[54px]" : "min-h-12",
        asking
          ? "border border-[var(--needs-edge)] py-[5px] pr-[9px] pl-[7px]"
          : "py-1.5 pr-2.5 pl-2"
      )}
    >
      {node.kind === "workflow" ? (
        <WorkflowTile />
      ) : (
        <Avatar {...agentAvatar(node.agentType)} size="sm" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <span
            className={cn(
              "truncate",
              node.kind === "workflow" && "font-mono text-[13px]"
            )}
          >
            {node.title}
          </span>
          {node.kind !== "workflow" && <StateMark node={node} />}
          {node.badge && <Pill>{node.badge}</Pill>}
        </span>
        <span
          className={cn(
            "truncate text-xs",
            asking ? "dark:text-needs text-amber-600" : "text-muted-foreground"
          )}
        >
          {node.kind === "workflow" ? workflowLine(node) : node.subtitle}
        </span>
      </span>
      {(age || tokens) && (
        <span className="flex-none text-right text-xs leading-[1.35] text-[#6B6B70] tabular-nums dark:text-[#8E8E93]">
          {age}
          {age && tokens && <br />}
          {tokens}
        </span>
      )}
      {branchy && <Folded collapsed={collapsed} />}
    </button>
  );
}

/** O-Tree's flat row: avatar, name and state, a short line, age */
function OpenRow({
  node,
  parent,
  selected,
  collapsed,
  onSelect,
  now,
}: RowProps) {
  const branchy = node.kind === "workflow" || node.kind === "phase";
  const asking = node.state === "needs";
  const line = shortLine(node);
  const label = nodeLabel(
    node,
    parent,
    node.kind === "fork" || node.kind === "handoff" || node.kind === "worker"
      ? agentName(node.agentType)
      : undefined
  );
  return (
    <button
      type="button"
      onClick={() => (branchy ? toggleCollapsed(node.id) : onSelect(node))}
      aria-label={selected ? `${label}, selected` : label}
      aria-current={selected ? "true" : undefined}
      aria-expanded={branchy && node.children.length ? !collapsed : undefined}
      className={cn(
        "text-foreground flex min-h-12 w-full items-center gap-2.5 rounded-xl py-1 pr-3 pl-2 text-left text-sm",
        selected &&
          "bg-primary/18 shadow-[inset_0_0_0_1px_rgba(167,139,250,.45)]",
        node.kind === "phase" &&
          (node.state === "queued"
            ? "text-muted-foreground"
            : "text-[#3A3A3F] dark:text-[#C7C7CC]")
      )}
    >
      {node.kind === "workflow" ? (
        <WorkflowTile />
      ) : node.kind === "phase" ? (
        <PhaseIcon node={node} />
      ) : (
        <Avatar {...agentAvatar(node.agentType)} size="sm" />
      )}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            "truncate",
            node.kind === "workflow" && "font-mono text-[13px]",
            (node.kind === "session" || node.kind === "phase") &&
              "font-semibold"
          )}
        >
          {node.title}
        </span>
        {!branchy && <StateMark node={node} />}
      </span>
      {node.badge ? (
        <Pill>{node.badge}</Pill>
      ) : (
        line && (
          <span
            className={cn(
              "max-w-[170px] truncate text-xs",
              asking
                ? "dark:text-needs text-amber-600"
                : selected
                  ? "text-[#3A3A3F] dark:text-[#C7C7CC]"
                  : "text-[#6B6B70] dark:text-[#8E8E93]"
            )}
          >
            {line}
          </span>
        )
      )}
      <span className="w-[30px] flex-none text-right text-xs text-[#6B6B70] tabular-nums dark:text-[#8E8E93]">
        {branchy && node.kind === "phase" ? (
          <Folded collapsed={collapsed} />
        ) : (
          nodeAge(node, now)
        )}
      </span>
    </button>
  );
}

/** A level of the tree: each node, then (unless folded) its own level */
function Level({
  nodes,
  parent,
  open,
  selectedId,
  onSelect,
  now,
}: {
  nodes: TreeNode[];
  parent: TreeNode;
  open: boolean;
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  now: number;
}) {
  const { collapsed: folded, allCollapsed } = useSnapshot(agentTreeStore);
  if (!nodes.length) return null;
  const Row = open ? OpenRow : ClosedRow;
  return (
    <ul className="m-0 list-none pl-5">
      {nodes.map((node) => {
        const collapsed =
          node.children.length > 0 && (folded[node.id] ?? allCollapsed);
        return (
          <li key={node.id} className={guideItem(open)}>
            <Row
              node={node}
              parent={parent}
              selected={node.id === selectedId}
              collapsed={collapsed}
              onSelect={onSelect}
              now={now}
            />
            {!collapsed && (
              <Level
                nodes={node.children}
                parent={node}
                open={open}
                selectedId={selectedId}
                onSelect={onSelect}
                now={now}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Agent-OS redesign · Live activity", "Agents · 7", the counts line */
function TreeHeader({
  title,
  tree,
  open,
}: {
  title: string;
  tree: AgentTreeResponse | undefined;
  open: boolean;
}) {
  const parts = tree ? countParts(tree.counts) : [];
  return (
    <header className="flex-none">
      <div className="text-muted-foreground truncate text-[13px]">
        {title} · Live activity
      </div>
      <h1 className={cn("t-title truncate", open ? "mt-0.5" : "mt-1")}>
        Agents{tree ? ` · ${tree.total}` : ""}
      </h1>
      {parts.length > 0 && (
        <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          {parts.map((p) => (
            <span key={p.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("h-2 w-2 rounded-full", COUNT_DOT[p.key])}
              />
              {p.text}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

/**
 * The family tree as an indented list (N-Tree on the closed Duo, O-Tree's
 * left page): the title "Agents · 7" and the counts line, the session's
 * card, then workflows → phases → agents, subagents and forks with guide
 * lines; finished ones hide unless Show finished, branches fold (a
 * workflow's or phase's row toggles it, the column's Collapse all folds
 * every one). Rows are buttons: an agent's selects it, a fork's, handoff's
 * or worker's (via onSelect) opens its session.
 */
export function AgentTree({
  session,
  tree,
  isLoading,
  variant,
  selectedId,
  onSelect,
  className,
}: {
  session: Session;
  tree: AgentTreeResponse | undefined;
  isLoading: boolean;
  /** closed: cards (N-Tree); open: flat rows in one card (O-Tree's left page) */
  variant: "closed" | "open";
  /** The selected node's id (open: its row is ringed); null for none */
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  className?: string;
}) {
  const { showFinished } = useSnapshot(agentTreeStore);
  const open = variant === "open";
  const now = Date.now();
  const title = tree?.root.title || session.name;
  const children = tree ? shownChildren(tree, showFinished) : [];
  const Row = open ? OpenRow : ClosedRow;

  let body: ReactNode;
  if (!tree)
    body = (
      <p className="text-muted-foreground px-1 py-6 text-sm">
        {isLoading ? "Loading agents…" : "Couldn't load the agents"}
      </p>
    );
  else
    body = (
      <ul
        aria-label="Agent tree"
        className={cn(
          "m-0 list-none p-0",
          open && "bg-card rounded-[20px] px-1.5 pt-2 pb-2.5"
        )}
      >
        <li>
          <Row
            node={tree.root}
            parent={null}
            selected={tree.root.id === selectedId}
            collapsed={false}
            onSelect={onSelect}
            now={now}
          />
          {children.length > 0 ? (
            <Level
              nodes={children}
              parent={tree.root}
              open={open}
              selectedId={selectedId}
              onSelect={onSelect}
              now={now}
            />
          ) : (
            <p className="text-muted-foreground px-3 pt-3 pb-1 text-sm">
              {tree.total > 0 ? "No agents running" : "No agents yet"}
            </p>
          )}
        </li>
      </ul>
    );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto",
        open ? "gap-3.5" : "gap-3",
        className
      )}
    >
      <TreeHeader title={title} tree={tree} open={open} />
      {body}
    </div>
  );
}
