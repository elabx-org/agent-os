import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentTreeResponse, TreeNode } from "../../lib/agent-tree-types";
import {
  columnFor,
  edgePath,
  fitScale,
  GRAPH,
  layoutAgentGraph,
  nodeMeta,
} from "../../components/Session/agent-graph-layout";

function n(
  id: string,
  kind: TreeNode["kind"],
  state: TreeNode["state"],
  children: TreeNode[] = []
): TreeNode {
  return {
    id,
    kind,
    title: id,
    subtitle: null,
    state,
    agentType: kind === "workflow" || kind === "phase" ? null : "claude",
    model: null,
    tokens: null,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    sessionId: null,
    agentId: null,
    children,
  };
}

/** D-Tree's tree: a workflow with Design (3 agents) and Critique (queued), Explore, a fork */
function dTree(): AgentTreeResponse {
  return {
    root: n("session:s", "session", "work"),
    children: [
      n("wf:r", "workflow", "work", [
        n("phase:r:1", "phase", "work", [
          n("agent:undo", "agent", "work"),
          n("agent:tree", "agent", "done"),
          n("agent:composer", "agent", "needs"),
        ]),
        n("phase:r:2", "phase", "queued", [
          n("agent:critic", "agent", "queued"),
        ]),
      ]),
      n("agent:explore", "subagent", "done"),
      n("session:fork", "fork", "work"),
    ],
    counts: { asking: 1, working: 2, done: 2, failed: 0, queued: 1 },
    total: 7,
  };
}

const at = (layout: ReturnType<typeof layoutAgentGraph>, id: string) => {
  const node = layout.nodes.find((x) => x.id === id);
  assert.ok(node, `no node ${id}`);
  return node;
};
const cy = (g: { y: number; h: number }) => g.y + g.h / 2;

test("columns follow D-Tree: session, workflow and subagents, phases, agents", () => {
  const l = layoutAgentGraph(dTree());
  assert.equal(at(l, "session:s").column, 0);
  assert.equal(at(l, "wf:r").column, 1);
  assert.equal(at(l, "agent:explore").column, 1);
  assert.equal(at(l, "session:fork").column, 1);
  assert.equal(at(l, "phase:r:1").column, 2);
  assert.equal(at(l, "agent:undo").column, 3);
  assert.deepEqual(
    l.columns.map((c) => c.x),
    [16, 236, 464, 656]
  );
  assert.equal(at(l, "phase:r:1").h, GRAPH.phaseH);
  assert.equal(at(l, "wf:r").w, 200);
  assert.equal(l.width, 656 + 196 + 16);
});

test("columnFor puts agents under a bare workflow in Agents and nests deeper ones past it", () => {
  assert.equal(columnFor("agent", 1), 3);
  assert.equal(columnFor("subagent", 0), 1);
  assert.equal(columnFor("subagent", 3), 4);
  assert.equal(columnFor("phase", 1), 2);
});

test("parents centre on their children's span; leaf agents stack 16 apart", () => {
  const l = layoutAgentGraph(dTree());
  const [undo, tree, composer] = [
    "agent:undo",
    "agent:tree",
    "agent:composer",
  ].map((id) => at(l, id));
  assert.equal(tree.y - (undo.y + undo.h), GRAPH.leafGap);
  assert.equal(composer.y - (tree.y + tree.h), GRAPH.leafGap);
  assert.equal(cy(at(l, "phase:r:1")), (cy(undo) + cy(composer)) / 2);
  assert.equal(cy(at(l, "phase:r:2")), cy(at(l, "agent:critic")));
  assert.equal(
    cy(at(l, "wf:r")),
    Math.round((cy(at(l, "phase:r:1")) + cy(at(l, "phase:r:2"))) / 2)
  );
  // Siblings never overlap within a column
  for (const c of [1, 2, 3]) {
    const col = l.nodes.filter((x) => x.column === c).sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++)
      assert.ok(col[i].y >= col[i - 1].y + col[i - 1].h, `overlap in ${c}`);
  }
  assert.equal(at(l, "agent:undo").y, GRAPH.padTop);
  const bottom = Math.max(...l.nodes.map((x) => x.y + x.h));
  assert.equal(l.height, bottom + GRAPH.padBottom);
});

test("a parent taller than its only child's span moves the branch down, not up", () => {
  const tree: AgentTreeResponse = {
    root: n("session:s", "session", "idle"),
    children: [
      n("wf:r", "workflow", "work", [n("phase:r:1", "phase", "queued")]),
    ],
    counts: { asking: 0, working: 1, done: 0, failed: 0, queued: 0 },
    total: 0,
  };
  const l = layoutAgentGraph(tree);
  for (const g of l.nodes) assert.ok(g.y >= GRAPH.padTop, `${g.id} above top`);
  assert.equal(cy(at(l, "wf:r")), cy(at(l, "phase:r:1")));
  assert.equal(cy(at(l, "session:s")), cy(at(l, "wf:r")));
});

test("edges: curves from right edge to left edge, dashed forks, dotted queued, state tones", () => {
  const l = layoutAgentGraph(dTree(), { selectedId: "agent:undo" });
  const edge = (to: string) => l.edges.find((e) => e.to === to)!;
  assert.equal(l.edges.length, 9);
  const s = at(l, "session:s");
  const wf = at(l, "wf:r");
  assert.equal(edge("wf:r").path, edgePath(s.x + s.w, cy(s), wf.x, cy(wf)));
  assert.match(edge("wf:r").path, /^M\d+ [\d.]+ C/);
  assert.equal(edge("session:fork").style, "dashed");
  assert.equal(edge("phase:r:2").style, "dotted");
  assert.equal(edge("agent:critic").style, "dotted");
  assert.equal(edge("agent:tree").style, "solid");
  assert.equal(edge("wf:r").tone, "work");
  assert.equal(edge("agent:composer").tone, "needs");
  assert.equal(edge("agent:tree").tone, "neutral");
  assert.equal(edge("agent:undo").tone, "selected");
  assert.equal(l.edges[l.edges.length - 1].to, "agent:undo");
});

test("Show finished off drops finished leaves but keeps the session", () => {
  const l = layoutAgentGraph(dTree(), { showFinished: false });
  const ids = l.nodes.map((x) => x.id);
  assert.ok(!ids.includes("agent:tree"));
  assert.ok(!ids.includes("agent:explore"));
  assert.ok(ids.includes("session:s"));
  assert.ok(!l.edges.some((e) => e.to === "agent:tree"));
});

test("stable across polls: the same tree lays out identically", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(layoutAgentGraph(dTree()))),
    JSON.parse(JSON.stringify(layoutAgentGraph(dTree())))
  );
});

test("a session with no agents is one card", () => {
  const l = layoutAgentGraph({
    root: n("session:s", "session", "idle"),
    children: [],
    counts: { asking: 0, working: 0, done: 0, failed: 0, queued: 0 },
    total: 0,
  });
  assert.equal(l.nodes.length, 1);
  assert.equal(l.edges.length, 0);
  assert.equal(l.columns.length, 1);
});

test("fitScale: fits the width, never above 1, floored at 0.9", () => {
  assert.equal(
    fitScale({ width: 500, height: 400 }, { width: 1000, height: 800 }),
    1
  );
  assert.equal(
    fitScale({ width: 1000, height: 800 }, { width: 950, height: 800 }),
    0.95
  );
  // A tall graph scrolls rather than shrinks
  assert.equal(
    fitScale({ width: 800, height: 4000 }, { width: 800, height: 600 }),
    1
  );
  assert.equal(
    fitScale({ width: 4000, height: 800 }, { width: 800, height: 800 }),
    0.9
  );
  assert.equal(
    fitScale({ width: 1000, height: 800 }, { width: 0, height: 0 }),
    1
  );
  // The four columns fit the desktop's ~810px canvas nearly at full size
  const four =
    GRAPH.padX * 2 +
    GRAPH.widths.reduce((a, b) => a + b, 0) +
    GRAPH.gaps.reduce((a, b) => a + b, 0);
  assert.ok(four <= 810 / 0.9, `${four} too wide`);
});

test("meta line: model · span · tokens", () => {
  const node = {
    ...n("agent:a", "agent", "work"),
    model: "Sonnet 4.6",
    tokens: 48_000,
    startedAt: "2026-10-29 10:00:00",
  };
  const now = Date.parse("2026-10-29T10:06:30Z");
  assert.equal(nodeMeta(node, now), "Sonnet 4.6 · 6m · 48k");
  const done = { ...node, model: null, finishedAt: "2026-10-29T10:08:00Z" };
  assert.equal(nodeMeta(done, now + 3_600_000), "8m · 48k");
  assert.equal(
    nodeMeta({ ...node, model: null }, now, "Codex"),
    "Codex · 6m · 48k"
  );
  assert.equal(nodeMeta(n("phase:x", "phase", "queued"), now), null);
  // The tree's own formats: 12.5M is "13M" and a 30h run "30h" in both
  assert.equal(
    nodeMeta({ ...node, model: null, tokens: 12_500_000 }, now),
    "6m · 13M"
  );
  assert.equal(
    nodeMeta(
      { ...node, model: null, tokens: null },
      Date.parse("2026-10-30T16:00:00Z")
    ),
    "30h"
  );
});
