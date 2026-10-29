import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalViewMode, nativeViewMode } from "../../lib/agent-views";
import type { PaneViewMode } from "../../stores/mobileNav";

const MODES: PaneViewMode[] = [
  "terminal",
  "chat",
  "files",
  "git",
  "workers",
  "agents",
];

test("canonicalViewMode: workers is the agents view, the rest as they are", () => {
  assert.equal(canonicalViewMode("workers"), "agents");
  assert.equal(canonicalViewMode("agents"), "agents");
  for (const mode of ["terminal", "chat", "files", "git"] as const)
    assert.equal(canonicalViewMode(mode), mode);
});

test("nativeViewMode: the iOS app 0.1.62 only ever gets a mode it knows", () => {
  const known = new Set(["terminal", "chat", "files", "git", "workers"]);
  for (const mode of MODES) assert.ok(known.has(nativeViewMode(mode)), mode);
  assert.equal(nativeViewMode("agents"), "workers");
  assert.equal(nativeViewMode(canonicalViewMode("workers")), "workers");
  assert.equal(nativeViewMode("chat"), "chat");
});
