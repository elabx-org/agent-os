import { proxy } from "valtio";
import type { WorkspacePage } from "@/stores/workspacePage";

/** Where a session was opened from, so its back returns there */
export type BackOrigin =
  | { kind: "page"; page: WorkspacePage }
  | { kind: "needs" }
  | { kind: "search" };

/**
 * What Back needs besides the layers the other stores hold: the label of a
 * pushed detail's own back (a page's, or the session's git and files
 * views'), where the focused session came from, and project names for the
 * labels. lib/nav-actions.ts backTarget() reads it
 */
export const backStore = proxy<{
  /** A workspace page's pushed detail (a preview, a sheet) is up */
  pageLabel: string | null;
  /** The git or files view's pushed detail (a diff, a commit, a file) */
  viewLabel: string | null;
  /**
   * Where the session opening came from; `left` is the session in view
   * then, still focused until the new one attaches
   */
  origin: { sessionId: string; from: BackOrigin; left: string | null } | null;
  projectNames: Record<string, string>;
}>({ pageLabel: null, viewLabel: null, origin: null, projectNames: {} });

export function setOrigin(
  sessionId: string,
  from: BackOrigin | null,
  left: string | null = null
): void {
  backStore.origin = from ? { sessionId, from, left } : null;
}
