import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addedLines,
  formatAge,
  formatTokens,
  liveSummary,
  phaseRows,
  workingLine,
} from "../../components/Session/activity-format";
import type { WorkflowInfo } from "../../lib/claude-workflows";

test("formatAge: seconds, minutes, hours", () => {
  assert.equal(formatAge(0), "0s");
  assert.equal(formatAge(40_000), "40s");
  assert.equal(formatAge(9 * 60_000 + 59_000), "9m");
  assert.equal(formatAge(60 * 60_000), "1h");
  assert.equal(formatAge(65 * 60_000), "1h 5m");
  assert.equal(formatAge(-5), "0s");
});

test("formatTokens: k and M, singular", () => {
  assert.equal(formatTokens(1), "1 token");
  assert.equal(formatTokens(850), "850 tokens");
  assert.equal(formatTokens(41_200), "41k tokens");
  assert.equal(formatTokens(1_200_000), "1.2M tokens");
  assert.equal(formatTokens(2_000_000), "2M tokens");
  assert.equal(formatTokens(12_400_000), "12M tokens");
});

test("liveSummary: either part, joined", () => {
  assert.equal(liveSummary(9 * 60_000, 41_000), "9m · 41k tokens");
  assert.equal(liveSummary(9 * 60_000, null), "9m");
  assert.equal(liveSummary(null, 41_000), "41k tokens");
  assert.equal(liveSummary(undefined, 0), "");
});

test("workingLine: a path cut to its name, a command whole", () => {
  assert.equal(
    workingLine({
      label: "Editing",
      command: "components/Session/ActivityStrip.tsx",
    }),
    "Editing ActivityStrip.tsx"
  );
  assert.equal(
    workingLine({ label: "Running", command: "npx tsc --noEmit" }),
    "Running npx tsc --noEmit"
  );
  assert.equal(workingLine({ label: "Working" }), "Working");
});

test("addedLines sums additions, untracked count nothing", () => {
  assert.equal(
    addedLines([
      { path: "a", status: "modified", staged: false, additions: 38 },
      { path: "b", status: "modified", staged: true, additions: 21 },
      { path: "c", status: "untracked", staged: false },
    ] as never),
    59
  );
});

const agent = (phase: string, status: "running" | "done") => ({
  agentId: `${phase}-${Math.random()}`,
  label: phase,
  phase,
  status,
  model: null,
  tokens: null,
});

test("phaseRows: done before the current phase, the current one counting", () => {
  const run: WorkflowInfo = {
    runId: "r",
    name: "review-changes",
    status: "running",
    phase: "Verify",
    phases: ["Review", "Verify", "Ship"],
    agents: [
      agent("Review", "done"),
      agent("Review", "done"),
      agent("Verify", "done"),
      agent("Verify", "running"),
      agent("Verify", "running"),
    ],
    startedAt: "2026-10-29T10:00:00Z",
    updatedAt: "2026-10-29T10:00:30Z",
  };
  const rows = phaseRows(run, Date.parse("2026-10-29T10:00:40Z"));
  assert.deepEqual(
    rows.map((r) => [r.name, r.detail, r.status, r.right]),
    [
      ["Review", "2 agents", "done", "done"],
      ["Verify", "1 of 3", "active", "40s"],
      ["Ship", "", "todo", ""],
    ]
  );
});

test("phaseRows: a finished run shows its phases with agents as done", () => {
  const run: WorkflowInfo = {
    runId: "r",
    name: "w",
    status: "stopped",
    phase: "Build",
    phases: ["Build", "Test"],
    agents: [agent("Build", "done")],
    startedAt: "2026-10-29T10:00:00Z",
    updatedAt: "2026-10-29T10:01:00Z",
  };
  assert.deepEqual(
    phaseRows(run).map((r) => [r.name, r.status]),
    [
      ["Build", "done"],
      ["Test", "todo"],
    ]
  );
});
