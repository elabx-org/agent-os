import { proxy } from "valtio";

/**
 * The Running view (M16): whether Labs has it on, mirrored from the flag
 * for what reads stores outside React (the iOS app's More menu, nav)
 */
export const runningStore = proxy<{
  enabled: boolean;
  /** The focused pane's session: a session's More shows what it runs */
  sessionId: string | null;
  /** A machine is linked and the tab is on the server: Runners is offered */
  runners: boolean;
  /**
   * The port of the newest web server the focused session started, or null:
   * with one, its header and More offer Preview
   */
  previewPort: number | null;
}>({ enabled: false, sessionId: null, runners: false, previewPort: null });
