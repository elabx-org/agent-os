/**
 * Switch a Claude session's model/effort between turns, hand a session off
 * to another agent, and resume a paused one (M4, N-Switch). Server only.
 *
 * Handoff: refused while the source is busy; creates the new session (same
 * project, cwd, worktree, branch), launches it (lib/session-launch.ts),
 * sends the summary (lib/summarize.ts) through the queue once it is ready,
 * and only then marks the source paused_at and ends its tmux (keeping
 * claude_session_id). On any failure the source keeps running, unmarked.
 */

import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type Database from "better-sqlite3";
import { getDb, queries, type Session } from "./db";
import { flagOnFor } from "./flags";
import {
  clearPaused,
  markHandedOff,
  restorePaused,
  setHandoffFrom,
  setModelEffort,
} from "./handoff-store";
import {
  isClaudeModelAlias,
  isEffortLevel,
  isHandoffAgent,
  isPaused,
  type EffortLevel,
  type HandoffError,
  type HandoffPreview,
  type HandoffRequest,
  type HandoffResult,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type ResumePausedRequest,
  type ResumePausedResult,
  type SessionSummary,
} from "./handoff-types";
import { effectiveMode, normalizeMode, type Mode } from "./permission-mode";
import { getProviderDefinition } from "./providers/registry";
import { sendOrQueue } from "./queue/dispatcher";
import {
  cancelItem,
  clearQueue,
  enqueue,
  listQueue,
  queueStore,
  type NewQueueItem,
} from "./queue/store";
import type { EnqueueResult, QueueItem } from "./queue/types";
import { readiness, type Readiness } from "./session-ready";
import { isRunning, launchSession, tmuxNameOf } from "./session-launch";
import { buildSummary } from "./summarize";
import { sendText } from "./tmux-send";

const execFileAsync = promisify(execFile);

/** A refusal the routes turn into its status and HandoffError body */
export class HandoffRefused extends Error {
  constructor(
    readonly status: number,
    readonly body: HandoffError
  ) {
    super(body.error);
  }
}

/** How long the new session gets to reach its prompt */
const READY_TIMEOUT_MS = 60_000;
/** How long the summary gets to go in once it is ready */
const SEND_TIMEOUT_MS = 30_000;
const POLL_MS = 1000;
/** Between the two reads that must agree before the summary is typed in */
const CONFIRM_MS = 500;

/** A model name passed to the agent's --model / -m flag */
const MODEL_NAME = /^[\w.-]+$/;

/** What the handoff flow touches, so the tests can run it without tmux */
export interface HandoffDeps {
  db: Database.Database;
  now(): number;
  sleep(ms: number): Promise<void>;
  isRunning(session: Session): Promise<boolean>;
  readiness(session: Session): Promise<Readiness>;
  launch(session: Session): Promise<boolean>;
  /** Ends the session's tmux */
  kill(session: Session): Promise<void>;
  summarize(session: Session): Promise<SessionSummary>;
  /** Types the summary in as the new session's first message; throws if not sent */
  sendSummary(session: Session, text: string): Promise<void>;
  queueOn(sessionId: string): boolean;
  enqueue(sessionId: string, item: NewQueueItem): QueueItem;
  listQueue(sessionId: string): QueueItem[];
  cancelItem(sessionId: string, itemId: number): boolean;
  /** Drops a session that never took over: its row and queue */
  discard(session: Session): void;
  /** The push for a new session with full access */
  announceFullAccess(session: Session): void;
}

function getSession(db: Database.Database, id: string): Session | null {
  return (queries.getSession(db).get(id) as Session | undefined) ?? null;
}

function expandHome(dir: string): string {
  return dir.replace(/^~(?=$|\/)/, os.homedir());
}

/** The folder a session works in */
export function workFolder(
  session: Pick<Session, "worktree_path" | "working_directory">
): string {
  return path.resolve(
    expandHome(session.worktree_path || session.working_directory || "~")
  );
}

/** The fields of the session a handoff creates */
export interface SuccessorFields {
  name: string;
  agentType: string;
  model: string | null;
  effort: EffortLevel | null;
  workingDirectory: string;
  permissionMode: Mode | null;
  autoApprove: boolean;
  projectId: string | null;
  groupPath: string;
  worktreePath: string | null;
  branchName: string | null;
  baseBranch: string | null;
}

/**
 * The new session for a handoff: the source's folder, worktree, branch,
 * project and permission mode (unless the request picks one). A Claude
 * native worktree (branch, no worktree_path) is entered directly by an
 * agent without the --worktree flag, when Claude has created it.
 */
export function successorFields(
  source: Session,
  request: HandoffRequest,
  exists: (dir: string) => boolean = fs.existsSync
): SuccessorFields {
  const agentType = request.agentType;
  const def = getProviderDefinition(agentType);

  let model: string | null = null;
  if (request.model) model = request.model;
  else if (agentType === "claude") {
    model =
      source.agent_type === "claude" && source.model ? source.model : "sonnet";
  }
  const effort =
    agentType === "claude" &&
    source.agent_type === "claude" &&
    isEffortLevel(source.effort)
      ? source.effort
      : null;

  const permissionMode =
    normalizeMode(request.permissionMode) ??
    normalizeMode(source.permission_mode) ??
    (source.auto_approve ? effectiveMode(source) : null);
  const autoApprove = permissionMode
    ? permissionMode === "bypassPermissions"
    : !!source.auto_approve;

  // Without the flag the branch stays only as the list's label
  let workingDirectory = source.working_directory || "~";
  if (source.branch_name && !source.worktree_path && !def.worktreeFlag) {
    const native = path.join(
      expandHome(workingDirectory),
      ".claude",
      "worktrees",
      source.branch_name
    );
    if (exists(native)) workingDirectory = native;
  }

  return {
    name: source.name,
    agentType,
    model,
    effort,
    workingDirectory,
    permissionMode,
    autoApprove,
    projectId: source.project_id ?? null,
    groupPath: source.group_path || "sessions",
    worktreePath: source.worktree_path,
    branchName: source.branch_name,
    baseBranch: source.base_branch,
  };
}

/** Writes the successor's row (as POST /api/sessions does) and returns it */
export function createSuccessor(
  db: Database.Database,
  source: Session,
  fields: SuccessorFields
): Session {
  const id = randomUUID();
  db.transaction(() => {
    queries
      .createSession(db)
      .run(
        id,
        fields.name,
        `${fields.agentType}-${id}`,
        fields.workingDirectory,
        null,
        fields.model,
        null,
        fields.groupPath,
        fields.agentType,
        fields.autoApprove ? 1 : 0,
        0,
        fields.projectId ?? "uncategorized"
      );
    if (fields.permissionMode) {
      queries
        .updateSessionPermissionMode(db)
        .run(fields.permissionMode, null, fields.autoApprove ? 1 : 0, id);
    }
    if (fields.worktreePath || fields.branchName) {
      // No dev server port: it stays the source's
      queries
        .updateSessionWorktree(db)
        .run(
          fields.worktreePath,
          fields.branchName,
          fields.baseBranch,
          null,
          id
        );
    }
    if (fields.model && fields.effort) {
      setModelEffort(db, id, fields.model, fields.effort);
    }
    setHandoffFrom(db, id, source.id);
  })();
  return getSession(db, id)!;
}

const COMMAND_PREFIXES = ["/model ", "/effort "];

/** The pending /model and /effort commands, superseded by a new pick */
function staleCommands(items: QueueItem[]): QueueItem[] {
  return items.filter(
    (i) =>
      i.kind === "command" &&
      i.status === "pending" &&
      COMMAND_PREFIXES.some((p) => i.text.startsWith(p))
  );
}

export function createHandoff(deps: HandoffDeps) {
  const inFlight = new Set<string>();

  async function switchModel(
    session: Session,
    request: ModelSwitchRequest
  ): Promise<ModelSwitchResult> {
    if ((session.agent_type || "claude") !== "claude") {
      throw new HandoffRefused(400, {
        error: "Only Claude sessions switch models",
        reason: "not_claude",
      });
    }
    if (!isClaudeModelAlias(request.model)) {
      throw new HandoffRefused(400, { error: "Unknown model" });
    }
    if (request.effort !== undefined && !isEffortLevel(request.effort)) {
      throw new HandoffRefused(400, { error: "Unknown effort level" });
    }
    const effort = request.effort ?? null;
    setModelEffort(deps.db, session.id, request.model, request.effort);

    // Running and taking queued commands: both go in at its next idle.
    // Otherwise they apply with --model/--effort when it next starts
    const live =
      !isPaused(session) &&
      deps.queueOn(session.id) &&
      (await deps.isRunning(session));
    if (!live) {
      return {
        item: null,
        queued: false,
        model: request.model,
        effort,
        effortApplies: effort ? "next_launch" : null,
      };
    }
    for (const stale of staleCommands(deps.listQueue(session.id))) {
      deps.cancelItem(session.id, stale.id);
    }
    const item = deps.enqueue(session.id, {
      text: `/model ${request.model}`,
      kind: "command",
      origin: "user",
    });
    if (effort) {
      deps.enqueue(session.id, {
        text: `/effort ${effort}`,
        kind: "command",
        origin: "user",
      });
    }
    return {
      item,
      queued: true,
      model: request.model,
      effort,
      effortApplies: effort ? "now" : null,
    };
  }

  /** Ready twice in a row before the deadline; false if it ended or timed out */
  async function waitReady(session: Session, until: number): Promise<boolean> {
    let readyOnce = false;
    while (deps.now() < until) {
      if (!(await deps.isRunning(session))) return false;
      const { ready } = await deps.readiness(session);
      if (ready && readyOnce) return true;
      readyOnce = ready;
      await deps.sleep(ready ? CONFIRM_MS : POLL_MS);
    }
    return false;
  }

  async function handoff(
    source: Session,
    request: HandoffRequest
  ): Promise<HandoffResult> {
    if (!isHandoffAgent(request.agentType)) {
      throw new HandoffRefused(400, { error: "Unknown agent" });
    }
    if (request.model !== undefined && !MODEL_NAME.test(request.model)) {
      throw new HandoffRefused(400, { error: "Unknown model" });
    }
    if (
      request.permissionMode !== undefined &&
      !normalizeMode(request.permissionMode)
    ) {
      throw new HandoffRefused(400, { error: "Unknown permission mode" });
    }
    if (isPaused(source)) {
      throw new HandoffRefused(409, { error: "Already handed off" });
    }
    if (inFlight.has(source.id)) {
      throw new HandoffRefused(409, {
        error: "A handoff is already under way",
        reason: "busy",
      });
    }
    inFlight.add(source.id);
    try {
      const running = await deps.isRunning(source);
      if (running && !(await deps.readiness(source)).ready) {
        throw new HandoffRefused(409, {
          error: "Between turns only",
          reason: "busy",
        });
      }

      const summary = await deps.summarize(source);
      if (!summary.text.trim()) {
        throw new HandoffRefused(400, {
          error: "Nothing to hand off yet",
          reason: "no_transcript",
        });
      }

      const fields = successorFields(source, request);
      const successor = createSuccessor(deps.db, source, fields);
      try {
        await deps.launch(successor);
        const ready = await waitReady(successor, deps.now() + READY_TIMEOUT_MS);
        if (!ready) throw new Error("The new session didn't reach its prompt");
        await deps.sendSummary(successor, summary.text);
        // The source changed while we waited (a resume, a second handoff)
        if (!markHandedOff(deps.db, source.id, successor.id, deps.now())) {
          throw new Error("The session changed during the handoff");
        }
      } catch (error) {
        await deps.kill(successor).catch(() => {});
        deps.discard(successor);
        throw error;
      }

      if (running) {
        await deps.kill(source).catch((error) => {
          // Marked paused already: it stays listed; its tmux just lingers
          console.error("[handoff] ending the source's tmux:", error);
        });
      }
      if (fields.autoApprove) deps.announceFullAccess(successor);
      return {
        newSessionId: successor.id,
        session: getSession(deps.db, successor.id) ?? successor,
      };
    } finally {
      inFlight.delete(source.id);
    }
  }

  async function handoffPreview(session: Session): Promise<HandoffPreview> {
    const busy =
      !isPaused(session) &&
      (await deps.isRunning(session)) &&
      !(await deps.readiness(session)).ready;
    try {
      const summary = await deps.summarize(session);
      return {
        summaryTokens: summary.tokens,
        filesChanged: summary.filesChanged.length,
        plan: summary.plan,
        busy,
      };
    } catch (error) {
      console.error("[handoff] preview summary:", error);
      return { summaryTokens: 0, filesChanged: 0, plan: null, busy };
    }
  }

  async function resumePaused(
    session: Session,
    request: ResumePausedRequest
  ): Promise<ResumePausedResult> {
    if (!isPaused(session)) {
      throw new HandoffRefused(400, {
        error: "This session isn't paused",
        reason: "not_paused",
      });
    }
    const successor = session.handoff_to_session_id
      ? getSession(deps.db, session.handoff_to_session_id)
      : null;
    if (
      !request.force &&
      successor &&
      !isPaused(successor) &&
      workFolder(successor) === workFolder(session) &&
      (await deps.isRunning(successor))
    ) {
      throw new HandoffRefused(409, {
        error: "The session it was handed to still works in this folder",
        reason: "successor_live",
        successorId: successor.id,
      });
    }
    if (
      !request.force &&
      (session.agent_type || "claude") === "claude" &&
      !session.claude_session_id
    ) {
      throw new HandoffRefused(400, {
        error: "No Claude conversation to resume",
        reason: "no_transcript",
      });
    }

    const pausedAt = session.paused_at!;
    if (!clearPaused(deps.db, session.id)) {
      throw new HandoffRefused(400, {
        error: "This session isn't paused",
        reason: "not_paused",
      });
    }
    const fresh = getSession(deps.db, session.id)!;
    try {
      // Claude: launchSession resumes claude_session_id (--resume)
      await deps.launch(fresh);
    } catch (error) {
      restorePaused(deps.db, session.id, pausedAt);
      throw error;
    }
    return { session: getSession(deps.db, session.id) ?? fresh };
  }

  return { switchModel, handoff, handoffPreview, resumePaused };
}

/**
 * The summary goes in as the new session's first message: through the
 * queue (sent now, or by the dispatcher) when it is on for the session,
 * else typed in once it reads ready twice. Throws when it didn't go
 */
async function sendSummaryLive(session: Session, text: string): Promise<void> {
  const until = Date.now() + SEND_TIMEOUT_MS;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (!flagOnFor("queue", session.id)) {
    while (Date.now() < until) {
      if ((await readiness(session)).ready) {
        await sleep(CONFIRM_MS);
        if ((await readiness(session)).ready) {
          await sendText(session, text, { pressEnter: true });
          return;
        }
      }
      await sleep(POLL_MS);
    }
    throw new Error("The new session didn't take the summary");
  }

  const store = queueStore();
  while (Date.now() < until) {
    const result: EnqueueResult = await sendOrQueue(
      session,
      { text, sendNow: true },
      "system"
    );
    if (result.sent) return;
    // Not ready yet: take it back and try again, unless the dispatcher
    // has already claimed it
    if (!store.cancelItem(session.id, result.item.id)) {
      while (Date.now() < until) {
        const item = store.getItem(session.id, result.item.id);
        if (item?.status === "sent") return;
        if (!item || item.status === "failed" || item.status === "cancelled") {
          throw new Error(item?.error || "The summary wasn't sent");
        }
        await sleep(POLL_MS);
      }
      store.cancelItem(session.id, result.item.id);
      break;
    }
    await sleep(POLL_MS);
  }
  throw new Error("The new session didn't take the summary");
}

const liveDeps = (): HandoffDeps => ({
  db: getDb(),
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isRunning,
  readiness,
  launch: (session) => launchSession(session),
  kill: async (session) => {
    await execFileAsync("tmux", [
      "kill-session",
      "-t",
      `=${tmuxNameOf(session)}`,
    ]);
  },
  summarize: (session) => buildSummary(session),
  sendSummary: sendSummaryLive,
  queueOn: (id) => flagOnFor("queue", id),
  enqueue,
  listQueue,
  cancelItem,
  discard: (session) => {
    const db = getDb();
    clearQueue(session.id);
    queries.deleteDraft(db).run(session.id);
    queries.deleteSession(db).run(session.id);
  },
  announceFullAccess: (session) => {
    import("./permission-guard")
      .then((m) => m.announceFullAccess(session))
      .catch(() => {});
  },
});

// One instance per module copy; the in-flight set guards double taps
let instance: ReturnType<typeof createHandoff> | null = null;
const live = () => (instance ??= createHandoff(liveDeps()));

export async function switchModel(
  session: Session,
  request: ModelSwitchRequest
): Promise<ModelSwitchResult> {
  return live().switchModel(session, request);
}

export async function handoff(
  session: Session,
  request: HandoffRequest
): Promise<HandoffResult> {
  return live().handoff(session, request);
}

export async function handoffPreview(
  session: Session
): Promise<HandoffPreview> {
  return live().handoffPreview(session);
}

export async function resumePaused(
  session: Session,
  request: ResumePausedRequest
): Promise<ResumePausedResult> {
  return live().resumePaused(session, request);
}
