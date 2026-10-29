import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchLooksValid,
  canOfferMove,
  followFolder,
  moveFootnote,
  moveNotes,
  moveRefusalText,
  moveSheetView,
  movesPollMs,
  MOVES_POLL_FAST_MS,
  MOVES_POLL_SLOW_MS,
  nowMoveLine,
  sessionNames,
  uncommittedLabel,
  type TextPart,
} from "../../components/Session/move-sheet-model";
import { changesCaption } from "../../lib/worktree-move-types";
import type { MovePreview, MoveState } from "../../lib/worktree-move-types";

const text = (parts: TextPart[]) => parts.map((p) => p.text).join("");
const monos = (parts: TextPart[]) =>
  parts.filter((p) => p.mono).map((p) => p.text);

const base = {
  agent_type: "claude" as const,
  worktree_path: null,
  branch_name: null,
  working_directory: "/config/workspace/gh/agent-os",
  paused_at: null,
};

test("canOfferMove: git folders only, not paused, shell or in a worktree", () => {
  const git = { nativeWorktreeFlag: true, isGit: true };
  assert.equal(canOfferMove(base, git), true);
  assert.equal(canOfferMove(base, { ...git, isGit: false }), false);
  // Unknown yet: hidden until the check answers
  assert.equal(canOfferMove(base, { ...git, isGit: null }), false);
  assert.equal(
    canOfferMove({ ...base, agent_type: "shell" as never }, git),
    false
  );
  assert.equal(canOfferMove({ ...base, paused_at: 1 }, git), false);
  assert.equal(
    canOfferMove({ ...base, worktree_path: "/x", branch_name: "b" }, git),
    false
  );
  // Claude's own --worktree: a branch without an Agent-OS worktree
  assert.equal(canOfferMove({ ...base, branch_name: "feat/x" }, git), false);
  // An agent without --worktree keeps its branch name in its own checkout
  assert.equal(
    canOfferMove(
      { ...base, agent_type: "codex" as never, branch_name: "feat/x" },
      { nativeWorktreeFlag: false, isGit: true }
    ),
    true
  );
  assert.equal(canOfferMove({ ...base, working_directory: "" }, git), false);
});

test("uncommittedLabel and changesCaption", () => {
  assert.equal(uncommittedLabel(0), null);
  assert.equal(uncommittedLabel(1), "1 uncommitted file");
  assert.equal(uncommittedLabel(3), "3 uncommitted files");
  assert.equal(
    changesCaption([
      { path: "ios/KeyboardBar.swift", status: " M" },
      { path: "ios/Haptics.swift", status: " M" },
      { path: "README.md", status: "??" },
    ]),
    "KeyboardBar.swift, Haptics.swift +1"
  );
});

test("moveNotes: the session's own agent first", () => {
  assert.deepEqual(
    moveNotes("claude").map((n) => n.text),
    [
      "Claude keeps its whole conversation and continues in the new folder.",
      "Codex starts fresh in the worktree with a summary.",
    ]
  );
  const codex = moveNotes("codex");
  assert.equal(codex[0].agentType, "codex");
  assert.equal(codex[1].agentType, "claude");
  assert.equal(
    moveNotes("gemini")[0].text,
    "Gemini starts fresh in the worktree with a summary."
  );
  assert.equal(moveNotes(null)[0].agentType, "claude");
});

test("sessionNames", () => {
  const s = (name: string) => ({ id: name, name });
  assert.equal(sessionNames([s("Ana")]), "Ana");
  assert.equal(sessionNames([s("Ana"), s("Bo")]), "Ana and Bo");
  assert.equal(sessionNames([s("A"), s("B"), s("C")]), "A, B and C");
  assert.equal(
    sessionNames([s("A"), s("B"), s("C"), s("D")]),
    "A, B and 2 more"
  );
});

test("moveFootnote: the mock's line, others in the folder, changes left", () => {
  const clean = moveFootnote({
    currentBranch: "main",
    takeChanges: true,
    changes: 3,
    otherSessions: [],
  });
  assert.equal(
    text(clean),
    "Your main checkout is left clean. The session keeps its tmux window and its place in Now."
  );
  assert.deepEqual(monos(clean), ["main"]);

  const shared = moveFootnote({
    currentBranch: "main",
    takeChanges: true,
    changes: 3,
    otherSessions: [{ id: "b", name: "Docs pass" }],
  });
  assert.match(
    text(shared),
    /^Your changes are copied but left in main because Docs pass also works there\./
  );
  assert.ok(!text(shared).includes("left clean"));

  const kept = moveFootnote({
    currentBranch: "main",
    takeChanges: false,
    changes: 3,
    otherSessions: [],
  });
  assert.ok(!text(kept).includes("clean"));
  assert.match(text(kept), /^Your uncommitted changes stay in main checkout\./);

  const none = moveFootnote({
    currentBranch: null,
    takeChanges: false,
    changes: 0,
    otherSessions: [],
  });
  assert.ok(!text(none).includes("clean"));
  assert.deepEqual(monos(none), []);
});

test("followFolder: renamed after the branch until edited", () => {
  const f = "~/.agent-os/worktrees/agent-os-fix-keyboardbar-haptics";
  assert.equal(
    followFolder(f, "fix/keyboardbar-haptics", "fix/keyboardbar-haptics"),
    f
  );
  assert.equal(
    followFolder(f, "fix/keyboardbar-haptics", "feat/arrow-keys"),
    "~/.agent-os/worktrees/agent-os-feat-arrow-keys"
  );
  // The mock's folder: the branch's last segment
  assert.equal(
    followFolder(
      "~/worktrees/keyboardbar-haptics",
      "fix/keyboardbar-haptics",
      "fix/arrows"
    ),
    "~/worktrees/arrows"
  );
  // Not from the branch (a -2 suffix): left as it is
  const two = "~/worktrees/agent-os-fix-x-2";
  assert.equal(followFolder(two, "fix/x", "fix/y"), two);
  assert.equal(followFolder(f, "fix/keyboardbar-haptics", "  "), f);
});

test("branchLooksValid", () => {
  for (const ok of ["fix/keyboardbar-haptics", "feat/a.b", "x", "user/x_y-2"])
    assert.equal(branchLooksValid(ok), true, ok);
  for (const bad of [
    "",
    " ",
    "a b",
    "a..b",
    "-x",
    "/x",
    "x/",
    "x.",
    "x.lock",
    "a//b",
    "a~1",
    "a^",
    "a:b",
    "a?",
    "a*",
    "a[b",
    "a\\b",
    "a@{1}",
    "@",
    "a/.b",
  ])
    assert.equal(branchLooksValid(bad), false, bad);
});

test("moveRefusalText", () => {
  assert.equal(
    moveRefusalText({ error: "Staged changes", reason: "staged" }),
    "Unstage or commit first"
  );
  assert.equal(
    moveRefusalText({
      error: "That branch already exists",
      reason: "branch_exists",
    }),
    "That branch already exists"
  );
  assert.equal(
    moveRefusalText({ error: "user_only", reason: "no_proof" }),
    "Reload to confirm it's you"
  );
  assert.equal(moveRefusalText(null), "Something went wrong");
});

const preview = (over: Partial<MovePreview> = {}): MovePreview => ({
  uncommitted: [{ path: "a.swift", status: " M" }],
  suggestedBranch: "fix/keyboardbar-haptics",
  folder: "/config/worktrees/keyboardbar-haptics",
  folderDisplay: "~/worktrees/keyboardbar-haptics",
  staged: false,
  otherSessions: [],
  repoName: "agent-os",
  currentBranch: "main",
  busy: false,
  mode: "resumed",
  agentType: "claude",
  refusal: null,
  pending: null,
  ...over,
});

const state = (over: Partial<MoveState> = {}): MoveState => ({
  sessionId: "s1",
  phase: "scheduled",
  branch: "fix/keyboardbar-haptics",
  worktreePath: "/config/worktrees/keyboardbar-haptics",
  takeChanges: true,
  mode: "resumed",
  queueItemId: 7,
  at: 1,
  error: null,
  keptWorktree: null,
  ...over,
});

const viewOf = (
  p: MovePreview | null,
  pending: MoveState | null = null,
  branch = "fix/keyboardbar-haptics",
  sending = false
) => moveSheetView({ preview: p, pending, branch, sending });

test("moveSheetView: loading, ready, busy", () => {
  assert.equal(viewOf(null).kind, "loading");
  assert.equal(viewOf(null).action, "none");

  const ready = viewOf(preview());
  assert.equal(ready.kind, "ready");
  assert.equal(ready.action, "move");
  assert.equal(ready.label, "Move session");
  assert.equal(ready.note, null);

  const busy = viewOf(preview({ busy: true }));
  assert.equal(busy.kind, "busy");
  assert.equal(busy.action, "move");
  assert.equal(busy.note, "Moves when Claude finishes this turn");
  assert.equal(
    viewOf(preview({ busy: true, agentType: "codex" })).note,
    "Moves when Codex finishes this turn"
  );

  assert.equal(viewOf(preview(), null, "bad branch").action, "none");
  assert.equal(viewOf(preview(), null, "fix/x", true).action, "none");
});

test("moveSheetView: scheduled cancels, moving waits", () => {
  const scheduled = viewOf(preview({ busy: true }), state());
  assert.equal(scheduled.kind, "scheduled");
  assert.equal(scheduled.action, "cancel");
  assert.equal(scheduled.label, "Cancel move");
  assert.equal(scheduled.editable, false);
  assert.equal(scheduled.note, "Moves when Claude finishes this turn");

  const moving = viewOf(preview(), state({ phase: "moving" }));
  assert.equal(moving.kind, "moving");
  assert.equal(moving.action, "none");
  assert.equal(moving.note, "Moving…");
});

test("moveSheetView: refusals disable the button", () => {
  const staged = viewOf(
    preview({
      staged: true,
      refusal: { error: "Staged changes", reason: "staged" },
    })
  );
  assert.equal(staged.kind, "refused");
  assert.equal(staged.action, "none");
  assert.match(staged.note!, /Unstage or commit first$/);

  const native = viewOf(
    preview({
      refusal: {
        error: "Sessions started with --worktree can't move yet",
        reason: "native_worktree",
      },
    })
  );
  assert.equal(native.action, "none");
  assert.equal(native.note, "Sessions started with --worktree can't move yet");
});

test("moveSheetView: a failed move says why and what was kept", () => {
  const failed = viewOf(
    preview(),
    state({
      phase: "failed",
      error: "Claude didn't come back within 60s.",
      keptWorktree: "/config/worktrees/keyboardbar-haptics",
    })
  );
  assert.equal(failed.kind, "failed");
  assert.equal(failed.noteError, true);
  assert.equal(failed.action, "move");
  assert.equal(failed.label, "Try again");
  assert.equal(
    failed.note,
    "Move failed: Claude didn't come back within 60s. The worktree is kept at /config/worktrees/keyboardbar-haptics."
  );
  const plain = viewOf(preview(), state({ phase: "failed", error: null }));
  assert.equal(plain.note, "Move failed: it was rolled back.");
  const blocked = viewOf(
    preview({ refusal: { error: "Staged", reason: "staged" } }),
    state({ phase: "failed", error: "x" })
  );
  assert.equal(blocked.action, "none");
});

test("nowMoveLine and movesPollMs", () => {
  assert.equal(nowMoveLine(state({ phase: "moving" })), "Moving…");
  assert.equal(nowMoveLine(state()), "Moves after this turn");
  assert.equal(nowMoveLine(state({ phase: "failed" })), "Move failed");
  assert.equal(nowMoveLine(null), null);
  assert.equal(movesPollMs([]), MOVES_POLL_SLOW_MS);
  assert.equal(movesPollMs([state({ phase: "failed" })]), MOVES_POLL_SLOW_MS);
  assert.equal(movesPollMs([state()]), MOVES_POLL_FAST_MS);
  assert.equal(movesPollMs([state({ phase: "moving" })]), MOVES_POLL_FAST_MS);
});
