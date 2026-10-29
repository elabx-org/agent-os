/**
 * Where the desktop agent graph (D-Tree) puts its cards and edges. Pure:
 * the same tree always lays out the same way, so cards hold still across
 * the 3s polls.
 *
 * Four columns: Session | Workflow and subagents | Phases | Agents. Each
 * parent sits vertically centred on its children's span, siblings stack
 * with a gap, and leaves keep to the right. A node nested deeper than the
 * Agents column gets a column of its own past it.
 */

import type { AgentState } from "@/lib/agent-state";
import type {
  AgentTreeResponse,
  TreeNode,
  TreeNodeKind,
} from "@/lib/agent-tree-types";
import { withoutFinished } from "@/lib/agent-tree-view";
import { nodeAge, shortTokens } from "./agent-tree-format";

export type EdgeStyle = "solid" | "dashed" | "dotted";
export type EdgeTone = "work" | "needs" | "neutral" | "error" | "selected";

export interface GraphNode {
  id: string;
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
  column: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** A cubic bezier from the parent's right edge to the child's left: "M.. C.." */
  path: string;
  style: EdgeStyle;
  tone: EdgeTone;
}

export interface GraphColumn {
  index: number;
  x: number;
  width: number;
}

export interface GraphLayout {
  /** Depth first: the session, then each branch top to bottom */
  nodes: GraphNode[];
  /** The selected node's edge last, so it draws on top */
  edges: GraphEdge[];
  /** Up to the last column in use */
  columns: GraphColumn[];
  width: number;
  height: number;
}

/**
 * D-Tree's measures, narrowed so the four columns fit the ~810px between
 * the desktop's sidebar and detail panel at full size or nearly
 */
export const GRAPH = {
  padX: 16,
  padTop: 16,
  padBottom: 24,
  cardH: 72,
  phaseH: 56,
  /** Column widths: Session, Workflow and subagents, Phases, Agents (and deeper) */
  widths: [184, 200, 156, 196] as const,
  /** Room after each column for the edges */
  gaps: [36, 28, 36] as const,
  gap: 36,
  /** Between leaf agents of one parent */
  leafGap: 16,
  /** Between sibling branches */
  branchGap: 28,
} as const;

export const COLUMN_TITLES = [
  "Session",
  "Workflow and subagents",
  "Phases",
  "Agents",
] as const;

/** Which column a node takes, from its kind and its parent's column */
export function columnFor(kind: TreeNodeKind, parentColumn: number): number {
  if (kind === "session") return 0;
  if (kind === "phase") return Math.max(2, parentColumn + 1);
  if (kind === "agent") return Math.max(3, parentColumn + 1);
  return parentColumn + 1;
}

function columnWidth(column: number): number {
  return GRAPH.widths[Math.min(column, GRAPH.widths.length - 1)];
}

function columnX(column: number): number {
  let x = GRAPH.padX;
  for (let c = 0; c < column; c++)
    x += columnWidth(c) + (GRAPH.gaps[c] ?? GRAPH.gap);
  return x;
}

function nodeHeight(node: TreeNode): number {
  return node.kind === "phase" ? GRAPH.phaseH : GRAPH.cardH;
}

function edgeTone(state: AgentState): EdgeTone {
  switch (state) {
    case "work":
      return "work";
    case "needs":
      return "needs";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

function edgeStyle(child: TreeNode): EdgeStyle {
  if (child.kind === "fork" || child.kind === "handoff") return "dashed";
  if (child.state === "queued") return "dotted";
  return "solid";
}

export function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const mx = Math.round((x1 + x2) / 2);
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

export function layoutAgentGraph(
  tree: AgentTreeResponse,
  {
    showFinished = true,
    selectedId = null,
  }: { showFinished?: boolean; selectedId?: string | null } = {}
): GraphLayout {
  const top = showFinished ? tree.children : withoutFinished(tree.children);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let lastColumn = 0;

  /**
   * Lays `node` and its branch out from `y0` down; returns the branch's
   * bottom and the node's centre. Children go first so the parent can
   * centre on them.
   */
  const place = (
    node: TreeNode,
    children: TreeNode[],
    column: number,
    y0: number
  ): { bottom: number; cy: number; index: number } => {
    lastColumn = Math.max(lastColumn, column);
    const h = nodeHeight(node);
    const index = nodes.length;
    const self: GraphNode = {
      id: node.id,
      node,
      x: columnX(column),
      y: y0,
      w: columnWidth(column),
      h,
      column,
    };
    nodes.push(self);
    if (children.length === 0) return { bottom: y0 + h, cy: y0 + h / 2, index };

    let cursor = y0;
    let bottom = y0;
    const placed: { cy: number; index: number; node: TreeNode }[] = [];
    children.forEach((child, i) => {
      if (i > 0) {
        const prev = children[i - 1];
        const leaves =
          prev.children.length === 0 && child.children.length === 0;
        cursor +=
          leaves && columnFor(child.kind, column) >= 3
            ? GRAPH.leafGap
            : GRAPH.branchGap;
      }
      const r = place(
        child,
        child.children,
        columnFor(child.kind, column),
        cursor
      );
      placed.push({ cy: r.cy, index: r.index, node: child });
      cursor = r.bottom;
      bottom = r.bottom;
    });

    const cy = Math.round((placed[0].cy + placed[placed.length - 1].cy) / 2);
    self.y = cy - h / 2;
    // Taller than its children's span: move the branch down under it
    const shift = y0 - self.y;
    if (shift > 0) {
      for (let i = index; i < nodes.length; i++) nodes[i].y += shift;
      bottom += shift;
    }
    bottom = Math.max(bottom, self.y + h);
    return { bottom, cy: self.y + h / 2, index };
  };

  const root = place(tree.root, top, 0, GRAPH.padTop);

  // Edges once every card has its final place
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const link = (parent: TreeNode, children: TreeNode[]) => {
    const p = byId.get(parent.id);
    if (!p) return;
    for (const child of children) {
      const c = byId.get(child.id);
      if (!c) continue;
      edges.push({
        from: p.id,
        to: c.id,
        path: edgePath(p.x + p.w, p.y + p.h / 2, c.x, c.y + c.h / 2),
        style: edgeStyle(child),
        tone: child.id === selectedId ? "selected" : edgeTone(child.state),
      });
      link(child, child.children);
    }
  };
  link(tree.root, top);
  edges.sort(
    (a, b) => Number(a.tone === "selected") - Number(b.tone === "selected")
  );

  const columns: GraphColumn[] = [];
  for (let c = 0; c <= lastColumn; c++)
    columns.push({ index: c, x: columnX(c), width: columnWidth(c) });
  const last = columns[columns.length - 1];
  return {
    nodes,
    edges,
    columns,
    width: last.x + last.width + GRAPH.padX,
    height: root.bottom + GRAPH.padBottom,
  };
}

/**
 * The scale at which the graph's width fits the box, never above 1 (a small
 * tree stays at its size) nor below `min` (text stays readable; past that,
 * scroll to pan). Its height never shrinks it: the canvas scrolls down.
 */
export function fitScale(
  layout: { width: number; height: number },
  box: { width: number; height: number },
  min = 0.9
): number {
  if (box.width <= 0) return 1;
  const s = Math.min(box.width / layout.width, 1);
  return Math.max(min, Math.round(s * 1000) / 1000);
}

/**
 * The card's third line: "Sonnet 4.6 · 6m · 48k" (model, how long it ran
 * or has been running, its context); null when there is nothing to say
 */
export function nodeMeta(
  node: TreeNode,
  now: number,
  fallbackModel: string | null = null
): string | null {
  const parts: string[] = [];
  const model = node.model ?? fallbackModel;
  if (model) parts.push(model);
  // The same age and tokens as the tree's rows
  const age = node.state === "queued" ? "" : nodeAge(node, now);
  if (age) parts.push(age);
  const tokens = shortTokens(node.tokens);
  if (tokens) parts.push(tokens);
  return parts.length ? parts.join(" · ") : null;
}
