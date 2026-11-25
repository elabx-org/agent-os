/**
 * A session restarted from somewhere else (another device, an agent, the
 * hub) ends the tmux session a tab was attached to and starts a new one:
 * the tab is left at its shell's prompt, under tmux's "[exited]". `started`
 * is when the session's tmux began (the status route): a later one than the
 * tab last saw means that, and the tab attaches again.
 */

/** What a tab knows of the tmux session it shows */
export interface Attached {
  sessionId: string;
  /** When that tmux session began; undefined until it's seen running */
  started: number | undefined;
  /** Attaches the server didn't type (something else runs there) */
  tries: number;
}

/** Then the tab is taken to show it already (its own attach started it) */
export const REATTACH_TRIES = 4;

/** For this long after it ended, ask for its status more often */
export const GONE_WATCH_MS = 60_000;

/** What tmux prints in a terminal whose session ended */
export const TMUX_ENDED = "[exited]";
/** A terminal in this page printed it */
export const TERMINAL_ENDED_EVENT = "agentos-terminal-ended";

export function seeStarted(
  known: Attached | undefined,
  sessionId: string,
  started: number | undefined
): { next: Attached; reattach: boolean } {
  if (!known || known.sessionId !== sessionId) {
    return { next: { sessionId, started, tries: 0 }, reattach: false };
  }
  // Not running now: what the tab was attached to stays what it knows
  if (started === undefined) return { next: known, reattach: false };
  // Never seen running: the tab's own attach starts it
  if (known.started === undefined) {
    return { next: { ...known, started }, reattach: false };
  }
  return { next: known, reattach: started !== known.started };
}

/** After an attach was asked of the tab's terminal */
export function afterReattach(
  known: Attached,
  typed: boolean,
  started: number
): Attached {
  if (typed || known.tries + 1 >= REATTACH_TRIES) {
    return { sessionId: known.sessionId, started, tries: 0 };
  }
  return { ...known, tries: known.tries + 1 };
}
