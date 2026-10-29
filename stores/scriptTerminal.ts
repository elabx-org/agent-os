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
}>({ pending: [] });

export function requestTerminalRun(request: TerminalRunRequest) {
  scriptTerminalStore.pending.push(request);
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
