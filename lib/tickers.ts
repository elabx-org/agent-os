/**
 * Background tickers, started once from server.ts. Each one checks its flag
 * (lib/flags.ts) and AGENTOS_DISABLE_TICKERS.
 */

import { getDb, queries, type Session } from "./db";
import {
  getFlagSessions,
  getFlags,
  tickersDisabled,
  type SessionFlagName,
} from "./flags";
import { startModeApplier } from "./permission-apply";
import { startDispatcher } from "./queue/dispatcher";
import { onEdge, startSessionWatch, wantWatch } from "./session-watch";
import { onIdleEdge } from "./turns";

/** On everywhere, or for at least one session */
function onSomewhere(name: SessionFlagName): boolean {
  return getFlags()[name] || !!getFlagSessions()[name]?.length;
}

export function startTickers(): void {
  if (tickersDisabled()) return;

  // The poll runs for the queue, snapshots and modes picked mid-turn even
  // with push turned off
  wantWatch(
    () =>
      onSomewhere("queue") || onSomewhere("snapshots") || getFlags().modeAtIdle
  );
  startSessionWatch();
  startDispatcher();
  startModeApplier();

  // The end of a turn: Codex/Gemini post snapshots, Claude's turn journal
  onEdge((edge) => {
    if (edge.from !== "running" || edge.to === "running") return;
    if (edge.to === "gone") return;
    let session: Session | undefined;
    try {
      session = queries.getSession(getDb()).get(edge.sessionId) as
        | Session
        | undefined;
    } catch (error) {
      console.error("[tickers] session lookup:", error);
    }
    if (!session) return;
    onIdleEdge(session).catch((error) =>
      console.error("[tickers] turn end:", error)
    );
  });
}
