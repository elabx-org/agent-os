import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activityOf,
  buildAgentTree,
  withoutPhase,
  type AgentActivity,
} from "../../lib/agent-tree";
import { listSubagents, subagentFile } from "../../lib/claude-subagents";
import { listWorkflows } from "../../lib/claude-workflows";
import {
  linkBackground,
  mentionedIds,
  sessionUsage,
} from "../../lib/agent-tree-links";
import { findNode, withoutFinished } from "../../lib/agent-tree-view";
import type { BackgroundAgent } from "../../lib/claude-background";
import type { Session } from "../../lib/db/types";
import type { TreeNode } from "../../lib/agent-tree-types";

const FIXTURES = path.join(__dirname, "fixtures", "agent-tree");

function session(over: Partial<Session> & { id: string }): Session {
  return {
    name: over.id,
    tmux_name: `claude-${over.id}`,
    created_at: "2026-10-29 09:00:00",
    updated_at: "2026-10-29 09:30:00",
    status: "idle",
    working_directory: "/repo",
    parent_session_id: null,
    claude_session_id: null,
    model: "opus",
    system_prompt: null,
    group_path: "sessions",
    project_id: null,
    agent_type: "claude",
    auto_approve: false,
    continue_session: false,
    worktree_path: null,
    branch_name: null,
    base_branch: null,
    dev_server_port: null,
    pr_url: null,
    pr_number: null,
    pr_status: null,
    conductor_session_id: null,
    worker_task: null,
    worker_status: null,
    pinned_order: null,
    permission_mode: null,
    permission_pending: null,
    launch_caps: null,
    ...over,
  };
}

const lines = (...entries: unknown[]) =>
  entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

const prompt = (text: string, at = "2026-10-29T09:10:00.000Z") => ({
  type: "user",
  timestamp: at,
  message: { role: "user", content: text },
});

const call = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  at = "2026-10-29T09:11:00.000Z",
  usage = 1000
) => ({
  type: "assistant",
  timestamp: at,
  message: {
    model: "claude-sonnet-4-6",
    content: [{ type: "tool_use", id, name, input }],
    usage: {
      input_tokens: usage,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
});

const result = (
  id: string,
  at = "2026-10-29T09:12:00.000Z",
  error = false
) => ({
  type: "user",
  timestamp: at,
  message: {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: id, content: "ok", is_error: error },
    ],
  },
});

/**
 * A Claude session's transcript with: a running workflow (Design: one
 * agent done, one waiting on a Bash call, one reading; Critique declared
 * but not started), a finished Explore subagent, and a stray copy of a
 * workflow agent's meta at the top level (must not show twice)
 */
function fixtureTranscript(runId: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-tree-"));
  const transcript = path.join(dir, "sess.jsonl");
  const scripts = path.join(dir, "scripts");
  fs.mkdirSync(scripts);
  fs.copyFileSync(
    path.join(FIXTURES, "agentos-feature-mocks-wf_fixture.js"),
    path.join(scripts, `agentos-feature-mocks-${runId}.js`)
  );
  fs.writeFileSync(
    transcript,
    lines(
      prompt("Mock the redesign"),
      {
        type: "user",
        timestamp: "2026-10-29T09:10:30.000Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_wf",
              content: `Workflow started: ${runId}\nScript file: ${scripts}/agentos-feature-mocks-${runId}.js`,
            },
          ],
        },
      },
      {
        type: "assistant",
        timestamp: "2026-10-29T09:20:00.000Z",
        message: {
          model: "claude-opus-5-5",
          content: [{ type: "text", text: "Waiting" }],
          usage: {
            input_tokens: 2000,
            output_tokens: 100,
            cache_read_input_tokens: 200_000,
            cache_creation_input_tokens: 10_000,
          },
        },
      }
    )
  );
  const subs = path.join(dir, "sess", "subagents");
  const run = path.join(subs, "workflows", runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(
    path.join(run, "journal.jsonl"),
    lines(
      { type: "launched" },
      { type: "started", agentId: "atree", label: "tree", phase: "Design" },
      {
        type: "started",
        agentId: "aundo",
        label: "undo-diff",
        phase: "Design",
      },
      { type: "started", agentId: "acomp", label: "composer", phase: "Design" },
      { type: "result", agentId: "atree", result: "3 mocks" }
    )
  );
  fs.writeFileSync(
    path.join(run, "agent-atree.jsonl"),
    lines(
      prompt("Mock the tree"),
      call("t1", "Write", {
        file_path: "/repo/.mock/N-Tree.dc.html",
        content: "a\nb\n",
      }),
      result("t1"),
      call("t2", "Write", {
        file_path: "/repo/.mock/O-Tree.dc.html",
        content: "a\n",
      }),
      result("t2")
    )
  );
  fs.writeFileSync(
    path.join(run, "agent-aundo.jsonl"),
    lines(
      prompt("Mock undo"),
      call("u1", "Write", { file_path: "/repo/.mock/O-Undo.dc.html" }),
      result("u1"),
      call("u2", "Bash", {
        command: "cd /repo && TOKEN=x node /tmp/tools/mockshot.js N-Undo 466",
      })
    )
  );
  fs.writeFileSync(
    path.join(run, "agent-acomp.jsonl"),
    lines(
      prompt("Mock the composer"),
      call("c1", "Read", { file_path: "/repo/ui.css" })
    )
  );
  // Plain subagent, finished
  fs.writeFileSync(
    path.join(subs, "agent-aexp.jsonl"),
    lines(
      prompt("Find the screens"),
      call("e1", "Glob", { pattern: "**/*.dc.html" }),
      result("e1"),
      call("e2", "Grep", { pattern: "screen" }),
      result("e2")
    )
  );
  fs.writeFileSync(
    path.join(subs, "agent-aexp.meta.json"),
    JSON.stringify({
      agentType: "Explore",
      description: "Explore",
      toolUseId: "toolu_exp",
      finished: true,
    })
  );
  // A workflow agent listed at the top level too
  fs.copyFileSync(
    path.join(run, "agent-atree.jsonl"),
    path.join(subs, "agent-atree.jsonl")
  );
  fs.writeFileSync(
    path.join(subs, "agent-atree.meta.json"),
    JSON.stringify({ agentType: "workflow-subagent", description: "tree" })
  );
  return transcript;
}

function readFixture(runId: string) {
  const transcript = fixtureTranscript(runId);
  const subagents = listSubagents(transcript);
  const workflows = listWorkflows(transcript);
  const activity: Record<string, AgentActivity> = {};
  for (const id of [
    ...subagents.map((s) => s.agentId),
    ...workflows.flatMap((w) => w.agents.map((a) => a.agentId)),
  ]) {
    const file = subagentFile(transcript, id);
    const a = file ? activityOf(file) : null;
    if (a) activity[id] = a;
  }
  return { transcript, subagents, workflows, activity };
}

const ME = session({ id: "me", name: "Agent-OS redesign", status: "waiting" });
const related = [
  session({
    id: "fork1",
    name: "Try sheet without blur",
    agent_type: "codex",
    parent_session_id: "me",
    status: "running",
    created_at: "2026-10-30 10:00:00",
  }),
  session({
    id: "worker1",
    name: "Fix the build",
    conductor_session_id: "me",
    worker_status: "running",
    worker_task: "Fix the build",
    status: "running",
    created_at: "2026-10-30 11:00:00",
  }),
  {
    ...session({
      id: "hand1",
      name: "Handed over",
      status: "idle",
      created_at: "2026-10-30 12:00:00",
    }),
    handoff_from_session_id: "me",
  } as Session,
  session({ id: "other", name: "Unrelated" }),
];
const bg: BackgroundAgent = {
  id: "1a2b3c4d",
  name: "Nightly audit",
  cwd: "/repo",
  state: "working",
  sessionId: "",
  startedAt: Date.parse("2026-10-30T13:00:00Z"),
};

test("merges workflow, phases, subagents, linked sessions and background", () => {
  const { transcript, subagents, workflows, activity } =
    readFixture("wf_fixture1");
  const tree = buildAgentTree({
    session: ME,
    subagents,
    workflows,
    related,
    background: [bg],
    now: Date.now(),
    activity,
    usage: sessionUsage(transcript),
  });

  assert.equal(tree.root.id, "session:me");
  assert.equal(tree.root.state, "needs");
  assert.equal(tree.root.subtitle, "waiting on the workflow");
  assert.equal(tree.root.model, "Opus 5.5");
  assert.equal(tree.root.tokens, 212_100);
  assert.deepEqual(tree.root.children, []);

  // Workflow and Explore were made today; the linked ones tomorrow
  const kinds = tree.children.map((n) => n.kind).sort();
  assert.deepEqual(kinds, [
    "background",
    "fork",
    "handoff",
    "subagent",
    "worker",
    "workflow",
  ]);
  assert.deepEqual(
    tree.children.slice(-4).map((n) => n.id),
    ["session:fork1", "session:worker1", "session:hand1", "bg:1a2b3c4d"]
  );

  const wf = tree.children.find((n) => n.kind === "workflow")!;
  assert.equal(wf.id, "wf:wf_fixture1");
  assert.equal(wf.title, "agentos-feature-mocks");
  assert.equal(wf.subtitle, "Workflow · phase 1 of 2");
  assert.deepEqual(wf.workflow, { phase: 1, phases: 2 });
  assert.equal(wf.state, "needs");

  const [design, critique] = wf.children;
  assert.equal(design.id, "phase:wf_fixture1:0");
  assert.equal(design.title, "Design");
  assert.equal(design.subtitle, "3 agents · 1 done");
  assert.deepEqual(design.phase, { agents: 3, done: 1, after: null });
  assert.equal(critique.title, "Critique");
  assert.equal(critique.state, "queued");
  assert.equal(critique.subtitle, "queued after Design");
  assert.deepEqual(critique.phase, { agents: 0, done: 0, after: "Design" });

  const byTitle = Object.fromEntries(design.children.map((n) => [n.title, n]));
  assert.equal(byTitle.tree.state, "done");
  assert.equal(byTitle.tree.subtitle, "Wrote 2 files");
  assert.equal(byTitle.tree.kind, "agent");
  assert.equal(byTitle.tree.id, "agent:atree");
  // The one call that can ask, while the session waits
  assert.equal(byTitle["undo-diff"].state, "needs");
  assert.equal(byTitle["undo-diff"].subtitle, "Wants to run mockshot.js");
  assert.equal(byTitle["undo-diff"].model, "Sonnet 4.6");
  assert.equal(byTitle["undo-diff"].tokens, 1010);
  assert.equal(byTitle.composer.state, "work");
  assert.equal(byTitle.composer.subtitle, "Reading ui.css");

  const explore = tree.children.find((n) => n.kind === "subagent")!;
  assert.equal(explore.title, "Explore");
  assert.equal(explore.state, "done");
  assert.equal(explore.subtitle, "2 tool uses");

  // No agent twice
  const ids: string[] = [];
  const walk = (nodes: TreeNode[]) =>
    nodes.forEach((n) => (ids.push(n.id), walk(n.children)));
  walk(tree.children);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id === "agent:atree").length, 1);

  const fork = findNode(tree, "session:fork1")!.node;
  assert.equal(fork.badge, "Fork");
  assert.equal(fork.subtitle, "Codex");
  assert.equal(fork.sessionId, "fork1");
  assert.equal(fork.stop, undefined);
  const worker = findNode(tree, "session:worker1")!.node;
  assert.equal(worker.badge, "Worker");
  assert.deepEqual(worker.stop, { kind: "worker", id: "worker1" });
  assert.equal(findNode(tree, "session:hand1")!.node.badge, "Handoff");
  assert.equal(findNode(tree, "session:other"), null);
  const bgNode = findNode(tree, "bg:1a2b3c4d")!.node;
  assert.equal(bgNode.badge, "Background");
  assert.deepEqual(bgNode.stop, { kind: "background", id: "1a2b3c4d" });

  // tree, undo-diff, composer, Explore, fork, worker, handoff, background
  assert.equal(tree.total, 8);
  assert.deepEqual(tree.counts, {
    asking: 1,
    working: 4,
    done: 2,
    failed: 0,
    queued: 1,
  });

  // Show finished off: tree and Explore go, the queued phase stays
  const live = withoutFinished(tree.children);
  assert.equal(
    live.some((n) => n.kind === "subagent"),
    false
  );
  const liveDesign = live.find((n) => n.kind === "workflow")!.children[0];
  assert.deepEqual(
    liveDesign.children.map((n) => n.title),
    ["undo-diff", "composer"]
  );
  assert.equal(live.find((n) => n.kind === "workflow")!.children.length, 2);
});

test("no one is asking while two agents could be", () => {
  const { subagents, workflows, activity } = readFixture("wf_fixture2");
  activity.acomp = { ...activity.acomp, canAsk: true };
  const tree = buildAgentTree({
    session: ME,
    subagents,
    workflows,
    related: [],
    background: [],
    now: Date.now(),
    activity,
  });
  assert.equal(tree.counts.asking, 0);
  assert.equal(tree.counts.working, 2);
  // Not waiting: nobody asks
  const idle = buildAgentTree({
    session: { ...ME, status: "running" },
    subagents,
    workflows,
    related: [],
    background: [],
    now: Date.now(),
    activity: readFixture("wf_fixture3").activity,
  });
  assert.equal(idle.counts.asking, 0);
});

test("a session with nothing under it", () => {
  const tree = buildAgentTree({
    session: session({ id: "solo", status: "running" }),
    subagents: [],
    workflows: [],
    related: [],
    background: [],
    now: Date.now(),
  });
  assert.equal(tree.root.state, "work");
  assert.equal(tree.root.subtitle, null);
  assert.deepEqual(tree.children, []);
  assert.equal(tree.total, 0);
});

test("finished workflow: phases done, no queued phase", () => {
  const tree = buildAgentTree({
    session: ME,
    subagents: [],
    workflows: [
      {
        runId: "wf_done",
        name: "w",
        status: "done",
        phase: "A",
        phases: ["A", "B"],
        agents: [
          {
            agentId: "x",
            label: "x",
            phase: "A",
            status: "done",
            model: "Opus 5.5",
            tokens: 10,
          },
          {
            agentId: "y",
            label: "y",
            phase: "Other phase",
            status: "done",
            model: null,
            tokens: 5,
          },
        ],
        startedAt: "2026-10-29T09:00:00.000Z",
        updatedAt: "2026-10-29T09:05:00.000Z",
      },
    ],
    related: [],
    background: [],
    now: Date.now(),
  });
  const wf = tree.children[0];
  assert.equal(wf.state, "done");
  assert.equal(wf.subtitle, "Workflow · 3 phases");
  assert.equal(wf.finishedAt, "2026-10-29T09:05:00.000Z");
  assert.equal(wf.tokens, 15);
  assert.deepEqual(
    wf.children.map((p) => [p.title, p.state]),
    [
      ["A", "done"],
      ["B", "done"],
      ["Other phase", "done"],
    ]
  );
  assert.equal(tree.counts.queued, 0);
  assert.equal(tree.counts.done, 2);
});

test("background agents link only when named in the conversation", () => {
  const me = session({
    id: "me",
    working_directory: "/repo",
    created_at: "2026-10-29 09:00:00",
  });
  const agent = (over: Partial<BackgroundAgent>): BackgroundAgent => ({
    ...bg,
    ...over,
  });
  const agents = [
    agent({ id: "aaaa1111" }),
    agent({ id: "bbbb2222", cwd: "/elsewhere" }),
    agent({ id: "cccc3333", startedAt: Date.parse("2026-10-28T00:00:00Z") }),
    agent({ id: "dddd4444", agentOsSessionId: "me" }),
    agent({ id: "eeee5555", cwd: "/repo/sub" }),
    agent({ id: "ffff6666" }),
  ];
  const candidates = linkBackground(me, agents, null);
  assert.deepEqual(
    candidates.map((a) => a.id),
    ["aaaa1111", "eeee5555", "ffff6666"]
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bg-"));
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(
    file,
    lines(result("x"), {
      type: "user",
      message: { content: "Started background agent aaaa1111 (Nightly)" },
    })
  );
  const ids = candidates.map((a) => a.id);
  assert.deepEqual([...mentionedIds(file, ids)], ["aaaa1111"]);
  // Appended later; a longer id containing one doesn't count
  fs.appendFileSync(file, lines({ note: "eeee5555 and xffff6666" }));
  assert.deepEqual([...mentionedIds(file, ids)].sort(), [
    "aaaa1111",
    "eeee5555",
  ]);
  assert.deepEqual(
    linkBackground(me, candidates, mentionedIds(file, ids)).map((a) => a.id),
    ["aaaa1111", "eeee5555"]
  );
});

test("a workflow agent's label drops its phase", () => {
  assert.equal(withoutPhase("design:undo-diff", "Design"), "undo-diff");
  assert.equal(withoutPhase("critique:tree", "Design"), "critique:tree");
  assert.equal(withoutPhase("tree", null), "tree");
  assert.equal(withoutPhase("design:", "Design"), "design:");
});
