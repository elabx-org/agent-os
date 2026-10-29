/**
 * The one poll of the managed tmux sessions (every 3s, a status counts once
 * it reads the same twice in a row). The push watcher, the queue dispatcher,
 * turn snapshots and later Limited and auto-resume subscribe to its edges
 * instead of polling tmux themselves. Started by lib/tickers.ts.
 */

import type { SessionStatus } from "./status-detector";

// M2 contract: signatures only; U2.1 extracts it from lib/push/watcher.ts

export interface WatchEdge {
  tmuxName: string;
  /** The Agent-OS session id (getSessionIdFromName) */
  sessionId: string;
  /** The stable status before; null on first sight (never an edge) */
  from: SessionStatus;
  /** "gone": the tmux session ended */
  to: SessionStatus | "gone";
  /** How long it ran before this edge, 0 when it wasn't running */
  workedMs: number;
  at: number;
}

export interface WatchedStatus {
  status: SessionStatus;
  /** When it became stable in this status (ms) */
  since: number;
}

/** Called on every stable status change; returns the unsubscribe */
export function onEdge(_cb: (edge: WatchEdge) => void): () => void {
  return () => {};
}

/** The last stable status seen for a session, null when not watched yet */
export function latest(_sessionId: string): WatchedStatus | null {
  return null;
}

/** Starts the poll once; later calls do nothing */
export function startSessionWatch(): void {}
