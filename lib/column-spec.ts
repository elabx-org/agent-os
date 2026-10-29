/**
 * What the control column holds on each surface, in each posture: one list
 * for the web column, the tabletop bar, the phone tab bar and (posted as
 * NativeState.column) the iOS app's own column, so they never disagree.
 */

import type { NavAction } from "@/lib/nav-actions";
import type { LayoutMode } from "@/hooks/useLayoutMode";
import type { PaneViewMode } from "@/stores/mobileNav";
import type { Surface } from "@/stores/surface";

export interface ColumnItem {
  id: NavAction;
  /** SF Symbol name, for the iOS app */
  symbol: string;
  /** lucide-react icon name (PascalCase), for the web */
  icon: string;
  label: string;
  badge?: number;
  /** amber: needs you; neutral: a plain count (changes) */
  badgeTone?: "amber" | "neutral";
  /** The filled accent circle (New) */
  prominent?: boolean;
  selected?: boolean;
  /** A separator before this item */
  sep?: true;
}

/** What the spec reads besides the surface and the posture */
export interface ColumnContext {
  /** The focused pane's view; null over the home or a page */
  viewMode: PaneViewMode | null;
  needsYou: number;
  changes: number;
  focus: boolean;
  /** An on-screen keyboard is up: the session column shrinks (Closed-Terminal) */
  keyboardUp: boolean;
  paneCount: number;
  canGoBack: boolean;
}

/**
 * The items for a surface, top to bottom (or left to right). Item sets as
 * in the plan's shell map: Now: + / Needs you / Projects / Find | Settings;
 * Session: back | Terminal-or-Chat, Changes, Files, Activity | More; ...
 */
export function columnFor(
  surface: Surface,
  mode: LayoutMode,
  ctx: ColumnContext
): ColumnItem[] {
  // Contract stub: U1.2
  void surface;
  void mode;
  void ctx;
  return [];
}
