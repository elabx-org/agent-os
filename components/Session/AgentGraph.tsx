"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useSnapshot } from "valtio";
import { Check, Clock, List, Minus, Plus, Workflow } from "lucide-react";
import type { Session } from "@/lib/db";
import type { AgentTreeResponse, TreeNode } from "@/lib/agent-tree-types";
import { STATE_DOT_CLASS, STATE_WORD } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import {
  agentTreeStore,
  setZoom,
  toggleShowFinished,
} from "@/stores/agentTree";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { Toggle } from "@/components/Settings/SettingGroup";
import {
  COLUMN_TITLES,
  fitScale,
  layoutAgentGraph,
  nodeMeta,
  type EdgeTone,
  type GraphLayout,
  type GraphNode,
} from "./agent-graph-layout";

/** The column titles' row above the cards */
const HEAD = 28;
const ZOOM_STEP = 1.2;

const EDGE_CLASS: Record<EdgeTone, string> = {
  work: "stroke-work/55",
  needs: "stroke-needs/60",
  error: "stroke-red-400/60",
  neutral: "stroke-foreground/20",
  selected: "stroke-[var(--sel)]",
};

const DASH = { solid: undefined, dashed: "5 5", dotted: "2 5" } as const;

/**
 * The desktop's family tree as a graph (D-Tree): columns Session ·
 * Workflow and subagents · Phases · Agents, hand-rolled SVG curved edges
 * coloured by state (dashed for forks, dotted for queued), the legend,
 * Show finished, and zoom − Fit +. Selecting a card selects the node; the
 * detail panel beside it is AgentDetailPane. Zoom 1 is Fit: the graph
 * scales down to the box's width (never below 0.9, then scroll to pan; a
 * tall graph scrolls down) and − + zoom from there.
 */
export function AgentGraph({
  tree,
  isLoading,
  selectedId,
  onSelect,
  className,
}: {
  session: Session;
  tree: AgentTreeResponse | undefined;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  className?: string;
}) {
  const { showFinished, zoom } = useSnapshot(agentTreeStore);
  const layout = useMemo(
    () => (tree ? layoutAgentGraph(tree, { showFinished, selectedId }) : null),
    [tree, showFinished, selectedId]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = layout
    ? fitScale({ width: layout.width, height: layout.height + HEAD }, box)
    : 1;
  const scale = fit * zoom;

  // Keep a newly selected card in view (not on every poll)
  const latest = useRef({ layout, scale });
  latest.current = { layout, scale };
  useEffect(() => {
    const el = scrollRef.current;
    const g = latest.current.layout?.nodes.find((n) => n.id === selectedId);
    if (!el || !g) return;
    const s = latest.current.scale;
    const pad = 16;
    const [l, t] = [g.x * s, (g.y + HEAD) * s];
    const [r, b] = [(g.x + g.w) * s, (g.y + g.h + HEAD) * s];
    if (l < el.scrollLeft) el.scrollLeft = l - pad;
    else if (r > el.scrollLeft + el.clientWidth)
      el.scrollLeft = r - el.clientWidth + pad;
    if (t < el.scrollTop) el.scrollTop = t - pad;
    else if (b > el.scrollTop + el.clientHeight)
      el.scrollTop = b - el.clientHeight + pad;
  }, [selectedId]);

  const cards = useRef(new Map<string, HTMLButtonElement>());
  const onKeyDown = (e: KeyboardEvent, g: GraphNode) => {
    if (!layout) return;
    const next = neighbour(layout, g, e.key);
    if (!next) return;
    e.preventDefault();
    cards.current.get(next)?.focus();
  };

  const hidden =
    !!tree && tree.children.length > 0 && layout?.nodes.length === 1;
  const now = Date.now();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col [--sel:hsl(var(--primary))] dark:[--sel:color-mix(in_srgb,hsl(var(--primary))_65%,white)]",
        className
      )}
    >
      <div className="mt-4 flex h-10 shrink-0 items-center gap-5 px-6">
        <div
          role="list"
          aria-label="Legend"
          className="flex min-w-0 items-center gap-[18px] overflow-hidden"
        >
          <LegendItem dot="bg-work">Working</LegendItem>
          <LegendItem dot="bg-needs">Needs you</LegendItem>
          <LegendItem dot="bg-[var(--sel)]">Done</LegendItem>
          <LegendItem dot="bg-red-400">Failed</LegendItem>
          <span
            role="listitem"
            className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-[13px]"
          >
            <span
              aria-hidden
              className="border-muted-foreground/70 w-[18px] border-t-2 border-dashed"
            />
            Fork
          </span>
        </div>
        <span className="flex-1" />
        <label className="text-foreground/80 flex shrink-0 items-center gap-2.5 text-sm">
          Show finished
          <Toggle
            checked={showFinished}
            onCheckedChange={toggleShowFinished}
            aria-label="Show finished"
          />
        </label>
        <div className="bg-card flex shrink-0 items-center gap-0.5 rounded-xl p-0.5">
          <ZoomButton
            label="Zoom out"
            disabled={zoom <= 0.4}
            onClick={() => setZoom(zoom / ZOOM_STEP)}
          >
            <Minus aria-hidden className="h-4 w-4" />
          </ZoomButton>
          <ZoomButton
            label="Fit to screen"
            onClick={() => setZoom(1)}
            className="w-auto px-2 text-[13px]"
          >
            Fit
          </ZoomButton>
          <ZoomButton
            label="Zoom in"
            disabled={zoom >= 2}
            onClick={() => setZoom(zoom * ZOOM_STEP)}
          >
            <Plus aria-hidden className="h-4 w-4" />
          </ZoomButton>
        </div>
      </div>

      <div
        ref={scrollRef}
        role="group"
        aria-label="Agent graph"
        className="relative mt-5 min-h-0 flex-1 overflow-auto"
      >
        {!layout ? (
          <Empty>
            {isLoading ? "Loading agents…" : "Couldn't load the agents"}
          </Empty>
        ) : (
          <div
            className="relative"
            style={{
              width: layout.width * scale,
              height: (layout.height + HEAD) * scale,
            }}
          >
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{
                width: layout.width,
                height: layout.height + HEAD,
                transform: `scale(${scale})`,
              }}
            >
              {layout.columns.map(
                (c) =>
                  COLUMN_TITLES[c.index] && (
                    <span
                      key={c.index}
                      className="text-muted-foreground absolute top-0 text-xs font-semibold tracking-[.02em]"
                      style={{ left: c.x }}
                    >
                      {COLUMN_TITLES[c.index]}
                    </span>
                  )
              )}
              <svg
                aria-hidden
                width={layout.width}
                height={layout.height}
                className="absolute left-0 fill-none"
                style={{ top: HEAD }}
              >
                {layout.edges.map((e) => (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={e.path}
                    className={EDGE_CLASS[e.tone]}
                    strokeWidth={e.tone === "selected" ? 2.25 : 1.75}
                    strokeDasharray={DASH[e.style]}
                  />
                ))}
              </svg>
              {layout.nodes.map((g) => (
                <GraphCard
                  key={g.id}
                  g={g}
                  now={now}
                  selected={g.id === selectedId}
                  onSelect={onSelect}
                  onKeyDown={onKeyDown}
                  cardRef={(el) => {
                    if (el) cards.current.set(g.id, el);
                    else cards.current.delete(g.id);
                  }}
                />
              ))}
            </div>
            {tree?.children.length === 0 && (
              <Empty className="absolute inset-x-0 top-[140px]">
                No agents yet. Subagents, workflows and forks this session
                starts show here.
              </Empty>
            )}
            {hidden && (
              <Empty className="absolute inset-x-0 top-[140px]">
                Every agent has finished.{" "}
                <button
                  type="button"
                  onClick={toggleShowFinished}
                  className="text-primary hover:underline"
                >
                  Show finished
                </button>
              </Empty>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Arrow keys walk the graph: up and down in a column, left to the parent, right to the first child */
function neighbour(
  layout: GraphLayout,
  g: GraphNode,
  key: string
): string | null {
  if (key === "ArrowLeft")
    return layout.edges.find((e) => e.to === g.id)?.from ?? null;
  if (key === "ArrowRight") {
    const kids = layout.edges
      .filter((e) => e.from === g.id)
      .map((e) => layout.nodes.find((n) => n.id === e.to)!)
      .sort((a, b) => a.y - b.y);
    return kids[0]?.id ?? null;
  }
  if (key !== "ArrowUp" && key !== "ArrowDown") return null;
  const column = layout.nodes
    .filter((n) => n.column === g.column)
    .sort((a, b) => a.y - b.y);
  const i = column.findIndex((n) => n.id === g.id);
  return column[key === "ArrowUp" ? i - 1 : i + 1]?.id ?? null;
}

function GraphCard({
  g,
  now,
  selected,
  onSelect,
  onKeyDown,
  cardRef,
}: {
  g: GraphNode;
  now: number;
  selected: boolean;
  onSelect: (node: TreeNode) => void;
  onKeyDown: (e: KeyboardEvent, g: GraphNode) => void;
  cardRef: (el: HTMLButtonElement | null) => void;
}) {
  const { node } = g;
  const { state, kind } = node;
  const phase = kind === "phase";
  const queued = state === "queued";
  const finished =
    state === "done" || state === "stopped" || state === "settled";
  const subtitle =
    (node.badge && node.subtitle && !node.subtitle.startsWith(node.badge)
      ? `${node.badge} · ${node.subtitle}`
      : node.subtitle) ??
    (node.phase
      ? `${node.phase.agents} agents · ${node.phase.done} done`
      : (node.badge ?? null));
  // A fork, handoff or worker that is another agent says which
  const otherAgent =
    node.agentType && node.agentType !== "claude" && kind !== "session"
      ? agentName(node.agentType)
      : null;
  const meta = phase ? null : nodeMeta(node, now, otherAgent);
  const dot = !phase && state !== "done" && state !== "stopped";

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={() => onSelect(node)}
      onKeyDown={(e) => onKeyDown(e, g)}
      aria-label={[node.title, subtitle, STATE_WORD[state]]
        .filter(Boolean)
        .join(" · ")}
      aria-current={selected || undefined}
      style={{ left: g.x, top: g.y + HEAD, width: g.w, height: g.h }}
      className={cn(
        "border-hair bg-card text-foreground hover:border-foreground/25 focus-visible:ring-ring absolute flex items-center gap-2.5 rounded-2xl border px-3 text-left transition-[box-shadow,border-color] focus-visible:ring-2 focus-visible:outline-none",
        state === "work" && "border-work/35",
        state === "needs" && "border-needs/50",
        state === "error" && "border-red-400/50",
        finished && "opacity-70",
        queued && "text-muted-foreground border-dashed bg-transparent",
        phase && "border-foreground/15 border-dashed bg-[var(--block)]",
        selected &&
          "border-[1.5px] border-[var(--sel)] opacity-100 shadow-[0_0_0_4px_hsl(var(--primary)/0.22)]"
      )}
    >
      {phase ? (
        queued ? (
          <Clock
            aria-hidden
            className="text-muted-foreground h-4 w-4 shrink-0"
          />
        ) : (
          <List aria-hidden className="text-foreground/70 h-4 w-4 shrink-0" />
        )
      ) : kind === "workflow" ? (
        <span
          aria-hidden
          className="bg-primary/20 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--sel)]"
        >
          <Workflow className="h-4 w-4" />
        </span>
      ) : queued ? (
        <Avatar
          label={agentAvatar(node.agentType).label}
          tone="other"
          size="sm"
        />
      ) : (
        <Avatar {...agentAvatar(node.agentType)} size="sm" />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate font-semibold",
            kind === "workflow" ? "font-mono text-xs" : "text-sm"
          )}
        >
          {node.title}
        </span>
        {subtitle && (
          <span
            className={cn(
              "mt-px block truncate text-xs",
              state === "needs"
                ? "dark:text-needs text-amber-600"
                : "text-muted-foreground"
            )}
          >
            {subtitle}
          </span>
        )}
        {meta && (
          <span className="text-muted-foreground/80 mt-0.5 block truncate text-[11px]">
            {meta}
          </span>
        )}
      </span>
      {state === "done" && !phase && (
        <span
          aria-hidden
          className="bg-primary flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        >
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} />
        </span>
      )}
      {dot && (
        <span
          aria-hidden
          className={cn(
            "border-background absolute -top-[7px] -right-[7px] h-3.5 w-3.5 rounded-full border-[3px]",
            STATE_DOT_CLASS[state]
          )}
        />
      )}
    </button>
  );
}

function LegendItem({ dot, children }: { dot: string; children: string }) {
  return (
    <span
      role="listitem"
      className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-[13px]"
    >
      <span aria-hidden className={cn("h-2 w-2 rounded-full", dot)} />
      {children}
    </span>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 items-center justify-center rounded-[10px] disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  );
}

function Empty({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm",
        className
      )}
    >
      <p className="max-w-sm">{children}</p>
    </div>
  );
}
