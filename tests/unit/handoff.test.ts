import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { QueueItem } from "../../lib/queue/types";
import type { SessionSummary } from "../../lib/handoff-types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-handoff-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let store: typeof import("../../lib/handoff-store");
let mod: typeof import("../../lib/handoff");
let providers: typeof import("../../lib/providers");

before(async () => {
  db = await import("../../lib/db");
  store = await import("../../lib/handoff-store");
  mod = await import("../../lib/handoff");
  providers = await import("../../lib/providers");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().exec("DELETE FROM sessions");
});

function addSession(
  id: string,
  extra: Partial<Record<keyof Session, unknown>> = {}
): Session {
  const d = db.getDb();
  db.queries
    .createSession(d)
    .run(
      id,
      `name-${id}`,
      `claude-${id}`,
      tmp,
      null,
      "opus",
      null,
      "sessions",
      "claude",
      0,
      0,
      "uncategorized"
    );
  for (const [key, value] of Object.entries(extra)) {
    d.prepare(`UPDATE sessions SET ${key} = ? WHERE id = ?`).run(value, id);
  }
  return row(id)!;
}

const row = (id: string) =>
  (db.queries.getSession(db.getDb()).get(id) as Session | undefined) ?? null;

describe("handoff store", () => {
  test("model and effort; effort kept when not given", () => {
    addSession("a");
    store.setModelEffort(db.getDb(), "a", "haiku", "high");
    assert.equal(row("a")!.model, "haiku");
    assert.equal(row("a")!.effort, "high");
    store.setModelEffort(db.getDb(), "a", "sonnet");
    assert.equal(row("a")!.model, "sonnet");
    assert.equal(row("a")!.effort, "high");
  });

  test("handed off once; resume clears and restore puts it back", () => {
    addSession("a");
    addSession("b");
    store.setHandoffFrom(db.getDb(), "b", "a");
    assert.equal(row("b")!.handoff_from_session_id, "a");
    assert.equal(store.markHandedOff(db.getDb(), "a", "b", 1000), true);
    assert.equal(store.markHandedOff(db.getDb(), "a", "c", 2000), false);
    assert.equal(row("a")!.paused_at, 1000);
    assert.equal(row("a")!.handoff_to_session_id, "b");
    assert.equal(store.clearPaused(db.getDb(), "a"), true);
    assert.equal(store.clearPaused(db.getDb(), "a"), false);
    assert.equal(row("a")!.paused_at, null);
    assert.equal(row("a")!.handoff_to_session_id, "b");
    store.restorePaused(db.getDb(), "a", 1000);
    assert.equal(row("a")!.paused_at, 1000);
  });
});

describe("claude --effort", () => {
  test("added for a known level only", () => {
    const flags = providers.claudeProvider.buildFlags({ effort: "high" });
    assert.ok(flags.includes("--effort high"));
    for (const effort of [null, undefined, "", "huge", "high; rm -rf /"]) {
      const f = providers.claudeProvider.buildFlags({ effort });
      assert.ok(!f.some((x) => x.startsWith("--effort")), String(effort));
    }
  });

  test("never for other agents", () => {
    const f = providers.codexProvider.buildFlags({ effort: "high" });
    assert.ok(!f.some((x) => x.includes("effort")));
  });
});

describe("successorFields", () => {
  test("same folder, project and mode; Claude model kept", () => {
    const source = addSession("a", {
      permission_mode: "acceptEdits",
      effort: "max",
      worktree_path: "/tmp/wt",
      branch_name: "feat",
      base_branch: "main",
    });
    const claude = mod.successorFields(source, { agentType: "claude" });
    assert.equal(claude.model, "opus");
    assert.equal(claude.effort, "max");
    assert.equal(claude.permissionMode, "acceptEdits");
    assert.equal(claude.autoApprove, false);
    assert.equal(claude.projectId, "uncategorized");
    assert.equal(claude.worktreePath, "/tmp/wt");
    assert.equal(claude.branchName, "feat");
    assert.equal(claude.name, source.name);

    const codex = mod.successorFields(source, {
      agentType: "codex",
      permissionMode: "bypassPermissions",
    });
    assert.equal(codex.model, null);
    assert.equal(codex.effort, null);
    assert.equal(codex.permissionMode, "bypassPermissions");
    assert.equal(codex.autoApprove, true);
  });

  test("auto_approve without a mode carries over", () => {
    const source = addSession("a", { auto_approve: 1 });
    const f = mod.successorFields(source, { agentType: "gemini" });
    assert.equal(f.permissionMode, "bypassPermissions");
    assert.equal(f.autoApprove, true);
  });

  test("a Claude native worktree is entered by an agent without the flag", () => {
    const source = addSession("a", { branch_name: "feat" });
    const native = path.join(tmp, ".claude", "worktrees", "feat");
    const codex = mod.successorFields(
      source,
      { agentType: "codex" },
      (dir) => dir === native
    );
    assert.equal(codex.workingDirectory, native);
    const claude = mod.successorFields(
      source,
      { agentType: "claude" },
      () => true
    );
    assert.equal(claude.workingDirectory, tmp);
    assert.equal(claude.branchName, "feat");
  });
});

/** Fake deps over the temp DB: no tmux, records what happened */
function fakes(over: Partial<import("../../lib/handoff").HandoffDeps> = {}) {
  const running = new Set<string>();
  const log: string[] = [];
  const queue: QueueItem[] = [];
  let nextId = 1;
  let clock = 0;
  const summary: SessionSummary = {
    text: "Summary of the work so far",
    tokens: 7,
    filesChanged: ["a.ts", "b.ts"],
    plan: { done: 3, total: 5 },
    source: "transcript",
  };
  const deps: import("../../lib/handoff").HandoffDeps = {
    db: db.getDb(),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    isRunning: async (s) => running.has(s.id),
    readiness: async () => ({ ready: true, holdReason: null }),
    launch: async (s) => {
      log.push(`launch ${s.agent_type} ${s.id}`);
      running.add(s.id);
      return true;
    },
    kill: async (s) => {
      log.push(`kill ${s.id}`);
      running.delete(s.id);
    },
    summarize: async () => summary,
    sendSummary: async (s, text) => {
      log.push(`send ${s.id} ${text}`);
    },
    queueOn: () => true,
    enqueue: (sessionId, item) => {
      const q: QueueItem = {
        id: nextId++,
        sessionId,
        position: queue.length + 1,
        text: item.text,
        attachments: [],
        origin: item.origin,
        kind: item.kind ?? "message",
        status: "pending",
        notBefore: null,
        createdAt: 0,
        sentAt: null,
        error: null,
      };
      queue.push(q);
      return q;
    },
    listQueue: (id) => queue.filter((q) => q.sessionId === id),
    cancelItem: (_id, itemId) => {
      const q = queue.find((i) => i.id === itemId);
      if (!q || q.status !== "pending") return false;
      q.status = "cancelled";
      return true;
    },
    discard: (s) => {
      log.push(`discard ${s.id}`);
      db.queries.deleteSession(db.getDb()).run(s.id);
    },
    announceFullAccess: (s) => log.push(`announce ${s.id}`),
    ...over,
  };
  return { deps, running, log, queue };
}

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (error) {
    assert.ok(error instanceof mod.HandoffRefused, String(error));
    return { status: error.status, ...error.body };
  }
  assert.fail("expected a refusal");
}

describe("switchModel", () => {
  test("queues /model and /effort for a running session", async () => {
    const f = fakes();
    const s = addSession("a");
    f.running.add("a");
    const h = mod.createHandoff(f.deps);
    await h.switchModel(s, { model: "sonnet" });
    const r = await h.switchModel(s, { model: "haiku", effort: "low" });
    assert.equal(r.queued, true);
    assert.equal(r.effortApplies, "now");
    assert.equal(r.item?.text, "/model haiku");
    const pending = f.queue.filter((q) => q.status === "pending");
    assert.deepEqual(
      pending.map((q) => [q.text, q.kind]),
      [
        ["/model haiku", "command"],
        ["/effort low", "command"],
      ]
    );
    assert.equal(row("a")!.model, "haiku");
    assert.equal(row("a")!.effort, "low");
  });

  test("queue off or stopped: stored for the next launch", async () => {
    const f = fakes({ queueOn: () => false });
    const s = addSession("a");
    f.running.add("a");
    const r = await mod
      .createHandoff(f.deps)
      .switchModel(s, { model: "opus", effort: "xhigh" });
    assert.equal(r.queued, false);
    assert.equal(r.item, null);
    assert.equal(r.effortApplies, "next_launch");
    assert.equal(f.queue.length, 0);
    assert.equal(row("a")!.effort, "xhigh");
  });

  test("Claude only", async () => {
    const s = addSession("a", { agent_type: "codex" });
    const r = await refusal(
      mod.createHandoff(fakes().deps).switchModel(s, { model: "opus" })
    );
    assert.equal(r.status, 400);
    assert.equal(r.reason, "not_claude");
  });
});

describe("handoff", () => {
  test("new session gets the summary, then the source is paused and ended", async () => {
    const f = fakes();
    const s = addSession("a", { permission_mode: "bypassPermissions" });
    f.running.add("a");
    const r = await mod
      .createHandoff(f.deps)
      .handoff(s, { agentType: "codex" });
    const n = row(r.newSessionId)!;
    assert.equal(n.agent_type, "codex");
    assert.equal(n.handoff_from_session_id, "a");
    assert.equal(n.working_directory, s.working_directory);
    assert.equal(n.tmux_name, `codex-${n.id}`);
    assert.equal(row("a")!.handoff_to_session_id, n.id);
    assert.ok(row("a")!.paused_at !== null);
    assert.deepEqual(f.log, [
      `launch codex ${n.id}`,
      `send ${n.id} Summary of the work so far`,
      "kill a",
      `announce ${n.id}`,
    ]);
  });

  test("keeps the pane's conversation id before ending the source", async () => {
    const f = fakes();
    f.deps.rememberTranscript = async (s) => {
      f.log.push(`remember ${s.id}`);
    };
    const s = addSession("r");
    f.running.add("r");
    const r = await mod
      .createHandoff(f.deps)
      .handoff(s, { agentType: "codex" });
    assert.deepEqual(f.log.slice(0, 4), [
      `launch codex ${r.newSessionId}`,
      `send ${r.newSessionId} Summary of the work so far`,
      "remember r",
      "kill r",
    ]);
  });

  test("busy source: refused, nothing created", async () => {
    const f = fakes({
      readiness: async () => ({ ready: false, holdReason: "busy" }),
    });
    const s = addSession("a");
    f.running.add("a");
    const r = await refusal(
      mod.createHandoff(f.deps).handoff(s, { agentType: "gemini" })
    );
    assert.equal(r.status, 409);
    assert.equal(r.reason, "busy");
    assert.equal(
      (db.queries.getAllSessions(db.getDb()).all() as Session[]).length,
      1
    );
  });

  test("a failed send drops the new session and leaves the source", async () => {
    const f = fakes({
      sendSummary: async () => {
        throw new Error("tmux gone");
      },
    });
    const s = addSession("a");
    f.running.add("a");
    await assert.rejects(
      mod.createHandoff(f.deps).handoff(s, { agentType: "codex" }),
      /tmux gone/
    );
    assert.equal(row("a")!.paused_at, null);
    assert.equal(row("a")!.handoff_to_session_id, null);
    assert.ok(f.running.has("a"));
    assert.equal(
      (db.queries.getAllSessions(db.getDb()).all() as Session[]).length,
      1
    );
  });

  test("a new session that never gets ready times out and is dropped", async () => {
    let n = 0;
    const f = fakes({
      readiness: async () =>
        n++ === 0
          ? { ready: true, holdReason: null }
          : { ready: false, holdReason: "asking" },
    });
    const s = addSession("a");
    f.running.add("a");
    await assert.rejects(
      mod.createHandoff(f.deps).handoff(s, { agentType: "codex" }),
      /prompt/
    );
    assert.equal(row("a")!.paused_at, null);
    assert.ok(f.log.some((l) => l.startsWith("discard")));
  });

  test("an empty summary is refused", async () => {
    const f = fakes({
      summarize: async () => ({
        text: " ",
        tokens: 0,
        filesChanged: [],
        plan: null,
        source: "transcript",
      }),
    });
    const s = addSession("a");
    const r = await refusal(
      mod.createHandoff(f.deps).handoff(s, { agentType: "codex" })
    );
    assert.equal(r.reason, "no_transcript");
  });
});

describe("resumePaused", () => {
  test("not paused", async () => {
    const s = addSession("a");
    const r = await refusal(
      mod.createHandoff(fakes().deps).resumePaused(s, {})
    );
    assert.equal(r.status, 400);
    assert.equal(r.reason, "not_paused");
  });

  test("successor live in the same folder: 409 unless forced", async () => {
    const f = fakes();
    addSession("b");
    const s = addSession("a", {
      paused_at: 5,
      handoff_to_session_id: "b",
      claude_session_id: "c-1",
    });
    f.running.add("b");
    const h = mod.createHandoff(f.deps);
    const r = await refusal(h.resumePaused(s, {}));
    assert.equal(r.status, 409);
    assert.equal(r.reason, "successor_live");
    assert.equal(r.successorId, "b");

    const ok = await h.resumePaused(s, { force: true });
    assert.equal(ok.session.paused_at, null);
    assert.deepEqual(f.log, ["launch claude a"]);
  });

  test("a failed launch keeps it paused", async () => {
    const f = fakes({
      launch: async () => {
        throw new Error("no tmux");
      },
    });
    const s = addSession("a", { paused_at: 5, claude_session_id: "c-1" });
    await assert.rejects(
      mod.createHandoff(f.deps).resumePaused(s, {}),
      /no tmux/
    );
    assert.equal(row("a")!.paused_at, 5);
  });
});

describe("preview", () => {
  test("carries over the summary's size, files and plan", async () => {
    const s = addSession("a");
    const p = await mod.createHandoff(fakes().deps).handoffPreview(s);
    assert.deepEqual(p, {
      summaryTokens: 7,
      filesChanged: 2,
      plan: { done: 3, total: 5 },
      busy: false,
    });
  });
});
