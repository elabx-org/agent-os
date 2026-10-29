/**
 * The one poll of the managed tmux sessions (every 3s, a status counts once
 * it reads the same twice in a row). The push watcher, the queue dispatcher,
 * turn snapshots and later Limited and auto-resume subscribe to its edges
 * instead of polling tmux themselves. Started by lib/tickers.ts.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { statusDetector, type SessionStatus } from "./status-detector";
import {
  getManagedSessionPattern,
  getSessionIdFromName,
} from "./providers/registry";
import { tickersDisabled } from "./flags";

const execAsync = promisify(exec);

const POLL_MS = 3000;

export interface WatchEdge {
  tmuxName: string;
  /** The AgentOS session id (getSessionIdFromName) */
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

interface Track {
  sessionId: string;
  /** The status acted on, after it read the same twice in a row */
  stable: SessionStatus;
  candidate: SessionStatus;
  runningSince: number | null;
  since: number;
}

/**
 * The two-reads stability rule, without the reading: feed it each poll's
 * statuses and it returns the edges. First sight only learns.
 */
export class WatchTracker {
  private tracks = new Map<string, Track>();

  observe(
    tmuxName: string,
    status: SessionStatus,
    now: number
  ): WatchEdge | null {
    const track = this.tracks.get(tmuxName);
    if (!track) {
      // First sight (or a server restart): learn, don't announce
      this.tracks.set(tmuxName, {
        sessionId: getSessionIdFromName(tmuxName),
        stable: status,
        candidate: status,
        runningSince: status === "running" ? now : null,
        since: now,
      });
      return null;
    }
    if (status !== track.candidate) {
      track.candidate = status;
      return null;
    }
    if (status === track.stable) return null;

    const from = track.stable;
    const workedMs = track.runningSince ? now - track.runningSince : 0;
    track.stable = status;
    track.runningSince = status === "running" ? now : null;
    track.since = now;
    return {
      tmuxName,
      sessionId: track.sessionId,
      from,
      to: status,
      workedMs,
      at: now,
    };
  }

  /** Forgets the sessions not seen in this poll: a "gone" edge each */
  sweep(seen: ReadonlySet<string>, now: number): WatchEdge[] {
    const edges: WatchEdge[] = [];
    for (const [tmuxName, track] of this.tracks) {
      if (seen.has(tmuxName)) continue;
      this.tracks.delete(tmuxName);
      edges.push({
        tmuxName,
        sessionId: track.sessionId,
        from: track.stable,
        to: "gone",
        workedMs: track.runningSince ? now - track.runningSince : 0,
        at: now,
      });
    }
    return edges;
  }

  latest(sessionId: string): WatchedStatus | null {
    for (const track of this.tracks.values()) {
      if (track.sessionId === sessionId)
        return { status: track.stable, since: track.since };
    }
    return null;
  }

  clear(): void {
    this.tracks.clear();
  }
}

export interface WatchReader {
  /** The managed tmux session names */
  list(): Promise<string[]>;
  status(tmuxName: string): Promise<SessionStatus>;
}

async function managedSessions(): Promise<string[]> {
  const pattern = getManagedSessionPattern();
  try {
    const { stdout } = await execAsync(
      "tmux list-sessions -F '#{session_name}' 2>/dev/null || true"
    );
    return stdout.split("\n").filter((name) => pattern.test(name));
  } catch {
    return [];
  }
}

const tmuxReader: WatchReader = {
  list: managedSessions,
  status: (tmuxName) => statusDetector.getStatus(tmuxName),
};

/** One poll: reads every session in turn and hands each edge to `emit` */
export async function pollOnce(
  tracker: WatchTracker,
  reader: WatchReader,
  emit: (edge: WatchEdge) => void,
  now: () => number = Date.now
): Promise<void> {
  const names = await reader.list();
  const seen = new Set<string>();
  for (const tmuxName of names) {
    seen.add(tmuxName);
    const edge = tracker.observe(
      tmuxName,
      await reader.status(tmuxName),
      now()
    );
    if (edge) emit(edge);
  }
  for (const edge of tracker.sweep(seen, now())) emit(edge);
}

// On globalThis: server.ts (the poll) and the API routes (Next's bundle,
// which read latest()) load separate copies of this module
const shared = globalThis as unknown as {
  __agentosWatch?: {
    tracker: WatchTracker;
    subscribers: Set<(edge: WatchEdge) => void>;
    /** Who needs the poll; it skips (and forgets) while nobody does */
    wants: Set<() => boolean>;
    started: boolean;
  };
};

function state() {
  shared.__agentosWatch ??= {
    tracker: new WatchTracker(),
    subscribers: new Set(),
    wants: new Set(),
    started: false,
  };
  return shared.__agentosWatch;
}

function emit(edge: WatchEdge): void {
  for (const cb of state().subscribers) {
    try {
      cb(edge);
    } catch (error) {
      console.error("[session-watch] subscriber:", error);
    }
  }
}

/** Called on every stable status change; returns the unsubscribe */
export function onEdge(cb: (edge: WatchEdge) => void): () => void {
  const { subscribers } = state();
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/**
 * Registers a need for the poll (the push watcher always, the dispatcher
 * while the queue or snapshots are on somewhere); returns the release
 */
export function wantWatch(needed: () => boolean): () => void {
  const { wants } = state();
  wants.add(needed);
  return () => wants.delete(needed);
}

/** The last stable status seen for a session, null when not watched yet */
export function latest(sessionId: string): WatchedStatus | null {
  return state().tracker.latest(sessionId);
}

function wanted(): boolean {
  for (const needed of state().wants) {
    try {
      if (needed()) return true;
    } catch {
      // A broken check doesn't keep the poll alive
    }
  }
  return false;
}

/** Starts the poll once; later calls do nothing */
export function startSessionWatch(): void {
  const watch = state();
  if (watch.started || tickersDisabled()) return;
  watch.started = true;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    if (!wanted()) {
      // Relearn from scratch when needed again, so a pause isn't an edge
      watch.tracker.clear();
      return;
    }
    busy = true;
    try {
      await pollOnce(watch.tracker, tmuxReader, emit);
    } catch (error) {
      console.error("[session-watch] poll:", error);
    } finally {
      busy = false;
    }
  }, POLL_MS).unref();
}
