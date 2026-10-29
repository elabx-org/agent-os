import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentTreeResponse, TreeNode } from "../../lib/agent-tree-types";
import {
  crumbsFor,
  findNode,
  flattenTree,
  isFinished,
  rootWithChildren,
  withoutFinished,
} from "../../lib/agent-tree-view";
import {
  cheapAgentCount,
  countParts,
  defaultSelection,
  detailTitle,
  nodeAge,
  nodeLabel,
  opensSession,
  hasDetail,
  phaseLine,
  shortLine,
  shortTokens,
  shownChildren,
  splitPath,
  toolAge,
  workflowLine,
} from "../../components/Session/agent-tree-format";

const T0 = Date.parse("2026-10-29T12:00:00Z");
const at = (mins: number) => new Date(T0 - mins * 60_000).toISOString();

function node(
  id: string,
  kind: TreeNode["kind"],
  extra: Partial<TreeNode> = {}
): TreeNode {
  return {
    id,
    kind,
    title: id,
    subtitle: null,
    state: "work",
    agentType: kind === "workflow" || kind === "phase" ? null : "claude",
    model: null,
    tokens: null,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    sessionId: null,
    agentId: null,
    children: [],
    ...extra,
  };
}

// N-Tree: the session, a workflow (Design: 3 agents, Critique queued),
// Explore done, a fork
const undo = node("agent:undo", "agent", {
  title: "undo-diff",
  agentId: "undo",
  subtitle: "Writing O-Undo.dc.html",
  startedAt: at(6),
  tokens: 48_000,
});
const composer = node("agent:composer", "agent", {
  title: "composer",
  agentId: "composer",
  state: "needs",
  subtitle: "Wants to run mockshot.js",
});
const treeAgent = node("agent:tree", "agent", {
  title: "tree",
  agentId: "tree",
  state: "done",
  startedAt: at(20),
  finishedAt: at(12),
});
const design = node("phase:wf1:1", "phase", {
  title: "Design",
  phase: { agents: 3, done: 1, after: null },
  children: [undo, composer, treeAgent],
});
const critique = node("phase:wf1:2", "phase", {
  title: "Critique",
  state: "queued",
  phase: { agents: 1, done: 0, after: "Design" },
});
const workflow = node("wf:wf1", "workflow", {
  title: "agentos-feature-mocks",
  workflow: { phase: 1, phases: 2 },
  children: [design, critique],
});
const explore = node("agent:explore", "subagent", {
  title: "Explore",
  agentId: "explore",
  state: "done",
  subtitle: "12 tool uses · found 29 screens",
});
const fork = node("session:fork", "fork", {
  title: "Try sheet without blur",
  agentType: "codex",
  sessionId: "fork",
  badge: "Fork",
});
const TREE: AgentTreeResponse = {
  root: node("session:s1", "session", {
    title: "Agent-OS redesign",
    sessionId: "s1",
    model: "Opus 5.5",
  }),
  children: [workflow, explore, fork],
  counts: { asking: 1, working: 3, done: 2, failed: 0, queued: 1 },
  total: 7,
};

test("rootWithChildren, findNode and crumbsFor walk the tree", () => {
  assert.equal(rootWithChildren(TREE).children.length, 3);
  const found = findNode(TREE, "agent:undo");
  assert.deepEqual(
    found?.path.map((n) => n.id),
    ["wf:wf1", "phase:wf1:1"]
  );
  assert.equal(findNode(TREE, "session:s1")?.path.length, 0);
  assert.equal(findNode(TREE, "gone"), null);
  assert.deepEqual(crumbsFor(TREE, "agent:undo"), [
    "Agent-OS redesign",
    "agentos-feature-mocks",
    "Design",
  ]);
  assert.deepEqual(crumbsFor(TREE, "gone"), ["Agent-OS redesign"]);
});

test("flattenTree: depth first with depths", () => {
  assert.deepEqual(
    flattenTree(TREE.children).map(
      ({ node: n, depth }) => `${n.title}:${depth}`
    ),
    [
      "agentos-feature-mocks:0",
      "Design:1",
      "undo-diff:2",
      "composer:2",
      "tree:2",
      "Critique:1",
      "Explore:0",
      "Try sheet without blur:0",
    ]
  );
});

test("withoutFinished drops finished agents but keeps live branches", () => {
  assert.equal(isFinished(treeAgent), true);
  assert.equal(isFinished(undo), false);
  const live = withoutFinished(TREE.children);
  assert.deepEqual(
    live.map((n) => n.id),
    ["wf:wf1", "session:fork"]
  );
  assert.deepEqual(
    live[0].children[0].children.map((n) => n.title),
    ["undo-diff", "composer"]
  );
  // A done workflow whose agents all finished goes too
  const doneRun = node("wf:old", "workflow", {
    state: "done",
    children: [node("agent:x", "agent", { state: "done" })],
  });
  assert.deepEqual(withoutFinished([doneRun]), []);
  assert.equal(shownChildren(TREE, true), TREE.children);
  assert.equal(shownChildren(TREE, false).length, 2);
});

test("countParts: only the states with any, in the mock's order", () => {
  assert.deepEqual(
    countParts(TREE.counts).map((p) => p.text),
    ["1 asking", "3 working", "2 done", "1 queued"]
  );
  assert.deepEqual(
    countParts({ asking: 0, working: 0, done: 0, failed: 2, queued: 0 }),
    [{ key: "failed", text: "2 failed" }]
  );
});

test("shortTokens and nodeAge: the rows' right column", () => {
  assert.equal(shortTokens(48_000), "48k");
  assert.equal(shortTokens(212_400), "212k");
  assert.equal(shortTokens(1_250_000), "1.3M");
  assert.equal(shortTokens(512), "512");
  assert.equal(shortTokens(null), "");
  assert.equal(shortTokens(0), "");
  assert.equal(nodeAge(undo, T0), "6m");
  // A finished one: how long it ran, not how long ago
  assert.equal(nodeAge(treeAgent, T0), "8m");
  assert.equal(nodeAge(node("x", "agent", { startedAt: at(65) }), T0), "1h");
  assert.equal(nodeAge(node("x", "agent"), T0), "");
  // SQLite's zoneless UTC time
  assert.equal(
    nodeAge(node("x", "agent", { startedAt: "2026-10-29 11:36:00" }), T0),
    "24m"
  );
});

test("nodeLabel: the rows' screen reader labels, as the mock", () => {
  assert.equal(nodeLabel(undo, design), "Design undo-diff, working");
  assert.equal(nodeLabel(composer, design), "Design composer, asking you");
  assert.equal(nodeLabel(treeAgent, design), "Design tree, done");
  assert.equal(nodeLabel(explore, TREE.root), "Explore, done");
  assert.equal(
    nodeLabel(fork, TREE.root, "Codex"),
    "Forked session Try sheet without blur, Codex, working"
  );
});

test("lines: workflow, phase and the open Duo's short line", () => {
  assert.equal(workflowLine(workflow), "Workflow · phase 1 of 2");
  assert.equal(phaseLine(design), "3 agents · 1 done");
  assert.equal(phaseLine(critique), "1 agent · queued after Design");
  assert.equal(
    phaseLine({ ...critique, subtitle: "from the server" }),
    "from the server"
  );
  assert.equal(shortLine(workflow), "phase 1 of 2");
  assert.equal(shortLine(design), "3 agents");
  assert.equal(shortLine(critique), "queued");
  assert.equal(shortLine(explore), "12 tool uses");
  assert.equal(shortLine(TREE.root), "Opus 5.5");
});

test("defaultSelection: the first working agent, else asking, else any", () => {
  assert.equal(defaultSelection(TREE), "agent:undo");
  const asking: AgentTreeResponse = {
    ...TREE,
    children: [explore, { ...composer }],
  };
  assert.equal(defaultSelection(asking), "agent:composer");
  assert.equal(
    defaultSelection({ ...TREE, children: [explore] }),
    "agent:explore"
  );
  assert.equal(defaultSelection({ ...TREE, children: [] }), null);
});

test("what a tap does: forks open their session, agents their detail", () => {
  assert.equal(opensSession(fork), true);
  assert.equal(opensSession(undo), false);
  assert.equal(hasDetail(undo), true);
  assert.equal(hasDetail(fork), false);
  assert.equal(hasDetail(workflow), false);
});

test("detail helpers: title, paths, tool ages", () => {
  assert.equal(
    detailTitle(undo, crumbsFor(TREE, undo.id)),
    "Design · undo-diff"
  );
  assert.equal(detailTitle(explore, ["Agent-OS redesign"]), "Explore");
  assert.deepEqual(splitPath(".mock/modern/N-Undo.dc.html"), {
    name: "N-Undo.dc.html",
    dir: ".mock/modern",
  });
  assert.deepEqual(splitPath("README.md"), { name: "README.md", dir: "" });
  assert.equal(toolAge(at(2), false, T0), "2m");
  assert.equal(toolAge(new Date(T0 - 40_000).toISOString(), false, T0), "40s");
  assert.equal(toolAge(at(0), true, T0), "now");
});

test("cheapAgentCount: subagents, workflow agents, forks and workers", () => {
  const sessions = [
    { parent_session_id: "s1", conductor_session_id: null },
    { parent_session_id: null, conductor_session_id: "s1" },
    { parent_session_id: "other", conductor_session_id: null },
  ];
  assert.equal(
    cheapAgentCount(
      "s1",
      [{}, {}],
      [{ agents: [{}, {}, {}] as never }],
      sessions
    ),
    7
  );
  assert.equal(cheapAgentCount("s2", [], [], sessions), 0);
});
