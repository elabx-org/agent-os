import { proxy } from "valtio";

/**
 * The Running view (M16): whether Labs has it on, mirrored from the flag
 * for what reads stores outside React (the iOS app's More menu, nav)
 */
export const runningStore = proxy<{
  enabled: boolean;
  /** The focused pane's session: a session's More shows what it runs */
  sessionId: string | null;
}>({ enabled: false, sessionId: null });
