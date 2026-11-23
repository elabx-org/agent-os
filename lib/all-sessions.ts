/**
 * All sessions: every session on this machine and the linked ones as tiles,
 * the ones that need you first. Pure, so the page and its tests share it.
 */
import type { Session } from "./db";
import type { MachineTag } from "./machine-now";
import { isEnded } from "./settle-types";

export type TileState = "needs" | "working" | "idle";
export type TileFilter = "all" | "needs" | "working";

export interface TileSource {
  /** Another machine's tag; null for the one this tab is on */
  tag: MachineTag | null;
  sessions: readonly Session[];
  statuses: Record<
    string,
    { status: string; lastLine?: string; recentLines?: string[] } | undefined
  >;
  projects: readonly {
    id: string;
    name: string;
    is_uncategorized?: boolean | number;
  }[];
}

export interface Tile {
  /** Unique across machines */
  key: string;
  tag: MachineTag | null;
  session: Session;
  state: TileState;
  /** The pane's last lines, oldest first (at most three) */
  lines: string[];
  /** The session's project by name; none outside every project */
  project?: string;
}

const ORDER: Record<TileState, number> = { needs: 0, working: 1, idle: 2 };
const LINES = 3;
/** Claude's own frame around the input, not something it said */
const CHROME = /^[\s─━│╭╮╰╯>❯?]*$|^\s*\? for shortcuts\s*$/;

/** The last few lines worth showing: rules and the input box left out */
export function tileLines(
  status: { lastLine?: string; recentLines?: string[] } | undefined
): string[] {
  const recent = (status?.recentLines ?? [])
    .map((line) => line.trim())
    .filter((line) => line && !CHROME.test(line));
  if (recent.length) return recent.slice(-LINES);
  const last = status?.lastLine?.trim();
  return last && !CHROME.test(last) ? [last] : [];
}

export function allTiles(sources: readonly TileSource[]): Tile[] {
  const tiles: Tile[] = [];
  for (const source of sources) {
    const names = new Map(
      source.projects
        .filter((p) => !p.is_uncategorized)
        .map((p) => [p.id, p.name])
    );
    for (const session of source.sessions) {
      // A conductor's workers show under it; an ended session is history
      if (session.conductor_session_id || isEnded(session)) continue;
      const status = source.statuses[session.id];
      const state: TileState =
        status?.status === "waiting"
          ? "needs"
          : status?.status === "running"
            ? "working"
            : "idle";
      tiles.push({
        key: `${source.tag?.target ?? ""}:${session.id}`,
        tag: source.tag,
        session,
        state,
        lines: tileLines(status),
        project: session.project_id ? names.get(session.project_id) : undefined,
      });
    }
  }
  // What needs you, then what works, then the rest; newest first in each
  return tiles.sort(
    (a, b) =>
      ORDER[a.state] - ORDER[b.state] ||
      b.session.updated_at.localeCompare(a.session.updated_at)
  );
}

/** `machine`: a tag's target, "" for this machine, null for every machine */
export function filterTiles(
  tiles: readonly Tile[],
  filter: TileFilter,
  machine: string | null
): Tile[] {
  return tiles.filter(
    (tile) =>
      (filter === "all" || tile.state === filter) &&
      (machine === null || (tile.tag?.target ?? "") === machine)
  );
}

export function tileCounts(tiles: readonly Tile[]) {
  let needs = 0;
  let working = 0;
  const machines = new Set<string>();
  for (const tile of tiles) {
    if (tile.state === "needs") needs++;
    else if (tile.state === "working") working++;
    machines.add(tile.tag?.target ?? "");
  }
  return { all: tiles.length, needs, working, machines: machines.size };
}

/** "5 on 2 machines", "1 session", "No sessions" */
export function allSummary(count: number, machines: number): string {
  if (count === 0) return "No sessions";
  if (machines > 1) return `${count} on ${machines} machines`;
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}
