import { proxy, useSnapshot } from "valtio";

/**
 * M3: a terminal script waiting for its session's shell drawer. The run
 * route returns `shellCommand`; the Pane opens its drawer when a request
 * names its session, and the drawer types the line once and consumes it.
 */
export interface TerminalRunRequest {
  runId: string;
  sessionId: string;
  shellCommand: string;
}

export const scriptTerminalStore = proxy<{
  pending: TerminalRunRequest[];
  /** The last run handed to each session's drawer */
  last: Record<string, string>;
}>({ pending: [], last: {} });

export function requestTerminalRun(request: TerminalRunRequest) {
  scriptTerminalStore.pending.push(request);
  if (request.shellCommand) {
    scriptTerminalStore.last[request.sessionId] = request.runId;
  }
}

/** The run last typed into this session's drawer (still running or not) */
export function lastTerminalRun(sessionId: string): string | undefined {
  return scriptTerminalStore.last[sessionId];
}

/** Taken by the drawer that typed it, so it runs once */
export function consumeTerminalRun(runId: string) {
  const i = scriptTerminalStore.pending.findIndex((r) => r.runId === runId);
  if (i >= 0) scriptTerminalStore.pending.splice(i, 1);
}

/** The oldest request for this session, if any */
export function useTerminalRunRequest(
  sessionId: string | null | undefined
): TerminalRunRequest | null {
  const { pending } = useSnapshot(scriptTerminalStore);
  return (sessionId && pending.find((r) => r.sessionId === sessionId)) || null;
}
