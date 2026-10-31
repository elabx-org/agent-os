// Multi-pane layout types and helpers

export type PaneLayout = PaneLayoutLeaf | PaneLayoutSplit;

export interface PaneLayoutLeaf {
  type: "leaf";
  paneId: string;
}

export interface PaneLayoutSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  children: PaneLayout[];
  sizes: number[];
}

export interface TabData {
  id: string;
  sessionId: string | null;
  attachedTmux: string | null;
  /** Asked for as a terminal (a tab or split you added): it starts a shell
      in tmux. Otherwise an empty tab waits for a session */
  shell?: boolean;
}

export interface PaneData {
  tabs: TabData[];
  activeTabId: string;
}

export interface PaneState {
  layout: PaneLayout;
  focusedPaneId: string;
  panes: Record<string, PaneData>;
}

// Generate unique tab ID
export function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Create a new tab
export function createTab(shell = false): TabData {
  return {
    id: generateTabId(),
    sessionId: null,
    attachedTmux: null,
    ...(shell && { shell }),
  };
}

// Create initial pane data with one tab
export function createPaneData(shell = false): PaneData {
  const tab = createTab(shell);
  return {
    tabs: [tab],
    activeTabId: tab.id,
  };
}

export const MAX_PANES = 4;
/** The open iPhone Duo: one session per page */
export const MAX_PANES_DUO = 2;

// Generate unique pane ID
export function generatePaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Create initial state with single pane
export function createInitialPaneState(): PaneState {
  const paneId = generatePaneId();
  return {
    layout: { type: "leaf", paneId },
    focusedPaneId: paneId,
    panes: {
      [paneId]: createPaneData(),
    },
  };
}

// Count total panes in layout
export function countPanes(layout: PaneLayout): number {
  if (layout.type === "leaf") {
    return 1;
  }
  return layout.children.reduce((sum, child) => sum + countPanes(child), 0);
}

// Find and replace a pane in the layout
export function replacePane(
  layout: PaneLayout,
  targetPaneId: string,
  newLayout: PaneLayout
): PaneLayout {
  if (layout.type === "leaf") {
    return layout.paneId === targetPaneId ? newLayout : layout;
  }
  return {
    ...layout,
    children: layout.children.map((child) =>
      replacePane(child, targetPaneId, newLayout)
    ),
  };
}

// Split a pane
export function splitPane(
  state: PaneState,
  paneId: string,
  direction: "horizontal" | "vertical",
  newPaneId: string = generatePaneId(),
  shell = false
): PaneState | null {
  if (countPanes(state.layout) >= MAX_PANES) {
    return null; // Max panes reached
  }

  const newSplit: PaneLayoutSplit = {
    type: "split",
    direction,
    children: [
      { type: "leaf", paneId },
      { type: "leaf", paneId: newPaneId },
    ],
    sizes: [50, 50],
  };

  return {
    layout: replacePane(state.layout, paneId, newSplit),
    focusedPaneId: newPaneId,
    panes: {
      ...state.panes,
      [newPaneId]: createPaneData(shell),
    },
  };
}

// Remove a pane from layout and return the remaining layout
function removePaneFromLayout(
  layout: PaneLayout,
  paneId: string
): PaneLayout | null {
  if (layout.type === "leaf") {
    return layout.paneId === paneId ? null : layout;
  }

  const newChildren: PaneLayout[] = [];
  for (const child of layout.children) {
    const result = removePaneFromLayout(child, paneId);
    if (result !== null) {
      newChildren.push(result);
    }
  }

  if (newChildren.length === 0) {
    return null;
  }
  if (newChildren.length === 1) {
    return newChildren[0]; // Collapse single-child splits
  }

  // Redistribute sizes
  const totalSize = layout.sizes.reduce((a, b) => a + b, 0);
  const newSizes = newChildren.map(() => totalSize / newChildren.length);

  return {
    ...layout,
    children: newChildren,
    sizes: newSizes,
  };
}

// Close a pane
export function closePane(state: PaneState, paneId: string): PaneState | null {
  if (countPanes(state.layout) <= 1) {
    return null; // Can't close last pane
  }

  const newLayout = removePaneFromLayout(state.layout, paneId);
  if (!newLayout) {
    return null;
  }

  const { [paneId]: _, ...remainingPanes } = state.panes;

  // If focused pane was closed, focus first remaining pane
  let newFocusedId = state.focusedPaneId;
  if (paneId === state.focusedPaneId) {
    newFocusedId = Object.keys(remainingPanes)[0];
  }

  return {
    layout: newLayout,
    focusedPaneId: newFocusedId,
    panes: remainingPanes,
  };
}

// Swap the two sides of a two-way split (the open Duo's pages)
export function swapPanes(state: PaneState): PaneState | null {
  const { layout } = state;
  if (layout.type !== "split" || layout.children.length !== 2) return null;
  return {
    ...state,
    layout: {
      ...layout,
      children: [...layout.children].reverse(),
      sizes: [...layout.sizes].reverse(),
    },
  };
}

// Get all pane IDs from layout
export function getAllPaneIds(layout: PaneLayout): string[] {
  if (layout.type === "leaf") {
    return [layout.paneId];
  }
  return layout.children.flatMap(getAllPaneIds);
}

// localStorage key for persisting pane state
const PANE_STATE_KEY = "agent-os-pane-state";

export function savePaneState(state: PaneState): void {
  try {
    localStorage.setItem(PANE_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage might be unavailable
  }
}

export function loadPaneState(): PaneState | null {
  try {
    const saved = localStorage.getItem(PANE_STATE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // localStorage might be unavailable or data corrupt
  }
  return null;
}
