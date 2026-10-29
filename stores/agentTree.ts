import { proxy } from "valtio";

/**
 * The agents view's own state (M13), shared by the tree (closed and open
 * Duo), the desktop graph and the column's Show finished / Collapse all,
 * which run outside the view (lib/nav-actions.ts)
 */
export const agentTreeStore = proxy<{
  /** Finished agents show (the column's eye, D-Tree's toggle) */
  showFinished: boolean;
  /** Every branch folded (the column's Collapse all); `open` overrides per node */
  allCollapsed: boolean;
  /** Per node id: true folded, false unfolded, over allCollapsed */
  collapsed: Record<string, boolean>;
  /** The selected node id, by session id (O-Tree's right page, D-Tree's panel) */
  selected: Record<string, string | null>;
  /** The desktop graph's zoom; 1 is Fit */
  zoom: number;
}>({
  showFinished: true,
  allCollapsed: false,
  collapsed: {},
  selected: {},
  zoom: 1,
});

export function toggleShowFinished() {
  agentTreeStore.showFinished = !agentTreeStore.showFinished;
}

/** Collapse all, or expand all when everything is folded already */
export function toggleAllCollapsed() {
  agentTreeStore.allCollapsed = !agentTreeStore.allCollapsed;
  agentTreeStore.collapsed = {};
}

export function toggleCollapsed(nodeId: string) {
  agentTreeStore.collapsed[nodeId] = !isCollapsed(nodeId);
}

export function isCollapsed(nodeId: string): boolean {
  return agentTreeStore.collapsed[nodeId] ?? agentTreeStore.allCollapsed;
}

export function selectNode(sessionId: string, nodeId: string | null) {
  agentTreeStore.selected[sessionId] = nodeId;
}

export function setZoom(zoom: number) {
  agentTreeStore.zoom = Math.min(2, Math.max(0.4, zoom));
}
