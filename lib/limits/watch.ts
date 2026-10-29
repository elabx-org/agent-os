/**
 * Limited detection as a lib/session-watch.ts subscriber (no poll of its
 * own): at the end of a turn (running -> idle/waiting) it reads the screen
 * and Claude's status for a limit and marks the session (push `limited`); on
 * the next busy edge it clears it (push `resumed` when it had been resumed
 * at the reset). Started from lib/tickers.ts. Never types into a session.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Project, type Session } from "../db";
import { readClaudeState, type ClaudeStatus } from "../claude-state";
import {
  cachedClaudeUsage,
  getClaudeUsage,
  type UsageResponse,
} from "../claude-usage";
import { stripAnsi } from "../session-ready";
import { onEdge, wantWatch, type WatchEdge } from "../session-watch";
import { formatReset } from "../usage-reset";
import { isWatching, readPushConfig } from "../push/config";
import { sendPush, type PushMessage } from "../push/send";
import { recordNotification, setDelivered } from "../push/history";
import {
  limitFromStatus,
  limitFromUsage,
  parseLimitScreen,
  resolveUntil,
  usageResetFor,
  type DetectedLimit,
} from "./detect";
import { limitStore, type LimitStore } from "./store";
import { limitKindLabel, limitStateOf, type LimitKind } from "./types";

const execFileAsync = promisify(execFile);

/** How often limited sessions with no known reset ask the usage cache */
const FILL_MS = 60_000;
/** A hook notification this much older than the turn's start is old */
const NOTE_SLACK_MS = 5_000;

type Notify = Pick<PushMessage, "kind" | "title" | "body" | "sessionId">;

export interface LimitWatchDeps {
  session(id: string): Session | undefined;
  /**
   * The session as notifications name it ("project · session"); the title
   * leads with the event, like the watcher's ("Limited · …"), which the
   * Needs you history reads as "<session> limited"
   */
  title(session: Session): string;
  /** The bottom of the pane, ANSI stripped */
  screen(tmuxName: string): Promise<string[] | null>;
  /** Claude's status line and its last hook notification */
  claude(sessionId: string): {
    status: ClaudeStatus | null;
    notification: { message: string | null; at: number } | null;
  };
  /** The usage API's last figures, without asking */
  usage(): UsageResponse | null;
  store: Pick<
    LimitStore,
    "markLimited" | "clearLimited" | "setUntil" | "listLimited"
  >;
  /** Records the event; sends it when its event toggle is on */
  notify(message: Notify, event: "limited" | "resumed"): void;
  now(): number;
}

async function capture(tmuxName: string): Promise<string[] | null> {
  try {
    // -J joins wrapped lines, so a narrow pane doesn't split the message
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane",
      "-p",
      "-J",
      "-t",
      `=${tmuxName}:`,
    ]);
    return stdout.replace(/\n+$/, "").split("\n").map(stripAnsi);
  } catch {
    return null;
  }
}

function where(session: Session): string {
  const db = getDb();
  const project = session.project_id
    ? (queries.getProject(db).get(session.project_id) as Project | undefined)
    : undefined;
  return project && !project.is_uncategorized
    ? `${project.name} · ${session.name}`
    : session.name;
}

function notify(message: Notify, event: "limited" | "resumed"): void {
  const entry = recordNotification(message);
  if (process.env.AGENTOS_DISABLE_PUSH === "1") return;
  const config = readPushConfig();
  const channels = config.ntfy.enabled || config.apns.enabled;
  if (!channels || !config.events[event]) return;
  if (message.sessionId && isWatching(message.sessionId)) return;
  sendPush({ ...message }).then((report) => {
    console.log(`[limits] ${message.title}:`, JSON.stringify(report));
    setDelivered(entry.id, report);
  });
}

function defaultDeps(): LimitWatchDeps {
  return {
    session: (id) => queries.getSession(getDb()).get(id) as Session | undefined,
    title: where,
    screen: capture,
    claude: (id) => {
      const state = readClaudeState(id);
      return { status: state.status, notification: state.notification };
    },
    usage: cachedClaudeUsage,
    store: limitStore(),
    notify,
    now: Date.now,
  };
}

/** "Claude hit the session limit · resets 3:40 pm" */
export function limitedBody(
  kind: LimitKind,
  until: number | null,
  now: number
): string {
  const head = `Claude hit the ${limitKindLabel(kind)}`;
  if (until === null) return head;
  const at = formatReset(new Date(until).toISOString(), {
    style: "long",
    now: new Date(now),
  });
  return at ? `${head} · resets ${at}` : head;
}

/**
 * What the end of a turn shows, from the screen, the hook's last
 * notification and the status line, with the reset from the best source
 */
export function detectLimit(input: {
  screen: readonly string[] | null;
  notification: { message: string | null; at: number } | null;
  /** When the turn began: an older notification isn't this turn's */
  turnStart: number;
  status: ClaudeStatus | null;
  usage: UsageResponse | null;
  now: number;
}): DetectedLimit | null {
  const { now } = input;
  const at = new Date(now);
  const fromScreen =
    (input.screen && parseLimitScreen(input.screen, at)) ||
    (input.notification?.message &&
    input.notification.at >= input.turnStart - NOTE_SLACK_MS
      ? parseLimitScreen([input.notification.message], at)
      : null);
  let fromStatus = limitFromStatus(input.status?.rate_limits ?? null);
  // A full window that has already reset is an old reading
  if (fromStatus && fromStatus.until !== null && fromStatus.until <= now)
    fromStatus = null;
  if (!fromScreen && !fromStatus) return null;

  let kind = fromScreen?.kind ?? fromStatus!.kind;
  if (kind === "unknown") {
    kind = fromStatus?.kind ?? limitFromUsage(input.usage, now)?.kind ?? kind;
  }
  const ahead = (ms: number | null | undefined) =>
    typeof ms === "number" && ms > now ? ms : null;
  const until = resolveUntil({
    status: fromStatus?.kind === kind ? ahead(fromStatus.until) : null,
    usage: usageResetFor(input.usage, kind, now),
    screen: ahead(fromScreen?.until),
  });
  return { kind, until };
}

/** One edge, with the deps injectable for the tests */
export async function handleLimitEdge(
  edge: WatchEdge,
  deps: LimitWatchDeps = defaultDeps()
): Promise<void> {
  if (edge.to === "gone") return;
  if (edge.to === "running") {
    const session = deps.session(edge.sessionId);
    if (!session || session.limited_at === null) return;
    const resumedAtReset = session.resume_policy === "at_reset";
    deps.store.clearLimited(session.id);
    if (resumedAtReset) {
      const kind = limitStateOf(session).kind;
      deps.notify(
        {
          kind: "resumed",
          sessionId: session.id,
          title: `Resumed · ${deps.title(session)}`,
          body: `Resumed after the ${limitKindLabel(kind)}`,
        },
        "resumed"
      );
    }
    return;
  }
  if (edge.from !== "running") return;

  const session = deps.session(edge.sessionId);
  if (!session || (session.agent_type || "claude") !== "claude") return;
  const now = deps.now();
  const claude = deps.claude(session.id);
  const usage = deps.usage();
  const found = detectLimit({
    screen: await deps.screen(edge.tmuxName),
    notification: claude.notification,
    turnStart: edge.at - edge.workedMs,
    status: claude.status,
    usage,
    now,
  });
  if (!found) return;

  const state = limitStateOf(session, now);
  if (state.limited && state.kind === found.kind) {
    // Already marked for this limit: only learn its reset if new
    if (state.limitedUntil === null && found.until !== null)
      deps.store.setUntil(session.id, found.until);
    return;
  }
  deps.store.markLimited(session.id, {
    at: now,
    until: found.until,
    kind: found.kind,
  });
  deps.notify(
    {
      kind: "limited",
      sessionId: session.id,
      title: `Limited · ${deps.title(session)}`,
      body: limitedBody(found.kind, found.until, now),
    },
    "limited"
  );
}

/**
 * Limited sessions whose reset no source said yet take it from the usage
 * API's figures once those have it. `refresh` asks the API (rate limited in
 * lib/claude-usage.ts) when one is still waiting
 */
export async function fillUntil(
  deps: Pick<LimitWatchDeps, "store" | "usage" | "now"> = defaultDeps(),
  refresh: () => Promise<unknown> = getClaudeUsage
): Promise<number> {
  const now = deps.now();
  const waiting = deps.store
    .listLimited()
    .filter((s) => s.limited_until === null);
  if (!waiting.length) return 0;
  let usage = deps.usage();
  const known = (s: Session) => {
    const kind = limitStateOf(s, now).kind ?? "unknown";
    return kind === "unknown"
      ? (limitFromUsage(usage, now)?.until ?? null)
      : usageResetFor(usage, kind, now);
  };
  if (waiting.some((s) => known(s) === null)) {
    await refresh();
    usage = deps.usage();
  }
  let filled = 0;
  for (const session of waiting) {
    const until = known(session);
    if (until === null) continue;
    deps.store.setUntil(session.id, until);
    filled++;
  }
  return filled;
}

const shared = globalThis as unknown as { __agentosLimitWatch?: boolean };

/** Subscribes to the session watch once; later calls do nothing */
export function startLimitWatch(): void {
  if (shared.__agentosLimitWatch) return;
  shared.__agentosLimitWatch = true;
  onEdge((edge) => {
    handleLimitEdge(edge).catch((error) =>
      console.error("[limits] watch:", error)
    );
  });
  wantWatch(() => true);
  setInterval(() => {
    fillUntil().catch((error) => console.error("[limits] reset:", error));
  }, FILL_MS).unref();
}
