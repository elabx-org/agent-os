import { proxy } from "valtio";
import type { TerminalHandle } from "@/components/Terminal";

export interface BesideRequest {
  sessionId: string;
  /** The view to show it in; its own last one otherwise */
  view?: "terminal" | "chat";
  ts: number;
}

/**
 * "Open beside": a session asks for a pane of its own next to the focused
 * one (the other page on the open Duo). The page splits or reuses a pane.
 */
export const besideStore = proxy<{ request: BesideRequest | null }>({
  request: null,
});

type Launch = (terminal: TerminalHandle) => void;
const launches = new Map<string, Launch>();

/** What a new pane runs once its terminal connects, instead of a shell */
export function setPaneLaunch(paneId: string, launch: Launch) {
  launches.set(paneId, launch);
}

export function takePaneLaunch(paneId: string): Launch | undefined {
  const launch = launches.get(paneId);
  launches.delete(paneId);
  return launch;
}

export function openBeside(sessionId: string, view?: "terminal" | "chat") {
  besideStore.request = { sessionId, view, ts: Date.now() };
}
