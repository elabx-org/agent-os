import { proxy } from "valtio";

/**
 * What the focused session's ⋯ offers beyond the column, for the column's
 * More and the iOS app's (the pane header's ⋯ is hidden on the closed Duo
 * and beside the pills). The focused pane's title bar keeps it current and
 * registers the handlers behind it.
 */
export const sessionActionsStore = proxy<{
  /** The session in view, for Copy session ID */
  sessionId: string | null;
  /** Its project has scripts to run (not Uncategorized) */
  scripts: boolean;
  /** It can be settled (N-Settle) */
  settle: boolean;
}>({
  sessionId: null,
  scripts: false,
  settle: false,
});
