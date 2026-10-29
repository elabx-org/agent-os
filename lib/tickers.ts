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
import { startLimitWatch } from "./limits/watch";
import { startResumeTicker } from "./limits/resume";
import { startModeApplier } from "./permission-apply";
import { startPrPoller } from "./pr-poller";
import { startDispatcher } from "./queue/dispatcher";
import { onEdge, startSessionWatch, wantWatch } from "./session-watch";
import { onIdleEdge, pruneSettled } from "./turns";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Settled sessions keep their turn snapshots this long (M8) */
const KEEP_SETTLED_TURNS_MS = 14 * DAY_MS;

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
  // Usage limits (M6): detection registers its own wantWatch; the resume
  // pass checks flag autoResume
  startLimitWatch();
  startResumeTicker();
  startModeApplier();
  // PR checks and auto-settle (M8): checks flags prPoller and autoSettle
  startPrPoller();
  // Daily, and once soon after a restart: drop the turn snapshots of
  // sessions settled two weeks ago
  const prune = () =>
    pruneSettled(KEEP_SETTLED_TURNS_MS).catch((error) =>
      console.error("[tickers] prune settled:", error)
    );
  setTimeout(prune, 10 * 60 * 1000).unref();
  setInterval(prune, DAY_MS).unref();

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
