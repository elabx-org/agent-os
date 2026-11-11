import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentEffort,
  currentModel,
  effortOptions,
  handoffRefusalText,
  modelAlias,
  modelDisplayName,
  modelPicks,
  pickLabel,
  familyPick,
  versionChoices,
  subagentSegment,
  modelRowCaption,
  currentSubagents,
  SUBAGENT_PICKS,
  subagentPickLabel,
  switchAction,
} from "../../components/Session/switch-model";

test("modelAlias: ids, names and aliases", () => {
  assert.equal(modelAlias("claude-opus-5-5"), "opus");
  assert.equal(modelAlias("Sonnet 5.5"), "sonnet");
  assert.equal(modelAlias("haiku"), "haiku");
  assert.equal(modelAlias("opus[1m]"), "opus");
  assert.equal(modelAlias("gpt-5-codex"), null);
  assert.equal(modelAlias(null), null);
});

test("modelDisplayName: Claude's name without the prefix or context note", () => {
  assert.equal(modelDisplayName("Opus 5.5"), "Opus 5.5");
  assert.equal(modelDisplayName("Claude Opus 5.5 (1M context)"), "Opus 5.5");
  assert.equal(modelDisplayName(""), null);
  assert.equal(modelDisplayName(undefined), null);
});

test("currentModel: the status line wins over sessions.model", () => {
  assert.deepEqual(
    currentModel(
      { id: "claude-sonnet-5-5", display_name: "Sonnet 5.5" },
      "opus"
    ),
    { alias: "sonnet", label: "Sonnet 5.5", model: "sonnet" }
  );
  assert.deepEqual(currentModel(null, "haiku"), {
    alias: "haiku",
    label: "Haiku",
    model: "haiku",
  });
  assert.deepEqual(currentModel(null, null), {
    alias: null,
    label: null,
    model: null,
  });
});

test("currentModel: an earlier version is its own pick", () => {
  assert.deepEqual(
    currentModel(
      { id: "claude-fable-5-1", display_name: "Fable 5.1" },
      "fable"
    ),
    { alias: "fable", label: "Fable 5.1", model: "claude-fable-5-1" }
  );
  // Stopped: from what was stored, named by its version
  assert.deepEqual(currentModel(null, "claude-opus-4-8"), {
    alias: "opus",
    label: "Opus 4.8",
    model: "claude-opus-4-8",
  });
  // The newest by its full id, a variant or a dated id: the alias
  assert.equal(currentModel({ id: "claude-fable-5-2" }, null).model, "fable");
  assert.equal(currentModel({ id: "claude-opus-5-5[1m]" }, null).model, "opus");
  assert.equal(
    currentModel({ id: "claude-haiku-4-5-20251001" }, null).model,
    "claude-haiku-4-5"
  );
  // "claude-fable-5" is not a prefix match for 5.2
  assert.equal(
    currentModel({ id: "claude-fable-5" }, null).model,
    "claude-fable-5"
  );
});

test("versions: a family's newest first, the picked one names its tile", () => {
  assert.deepEqual(
    versionChoices("opus").map((c) => [c.id, c.label, c.name]),
    [
      ["opus", "5.5", "Opus 5.5, newest"],
      ["claude-opus-5", "5", "Opus 5"],
      ["claude-opus-4-8", "4.8", "Opus 4.8"],
      ["claude-opus-4-7", "4.7", "Opus 4.7"],
      ["claude-opus-4-6", "4.6", "Opus 4.6"],
    ]
  );
  assert.deepEqual(
    versionChoices("haiku").map((c) => c.label),
    ["5.5", "4.5"]
  );
  const current = currentModel(
    { id: "claude-fable-5-2", display_name: "Fable 5.2" },
    "fable"
  );
  const picks = modelPicks(current, "claude-fable-5-1");
  assert.deepEqual(
    [picks[0].label, picks[0].caption],
    ["Fable 5.1", "Most capable"]
  );
  assert.equal(modelPicks(current, "fable")[0].caption, "Current");
  assert.equal(pickLabel("claude-opus-4-8", current), "Opus 4.8");
  // The lit tile keeps its version; another family starts at its newest
  const held = currentModel({ id: "claude-fable-5-1" }, null);
  assert.equal(familyPick("fable", held), "claude-fable-5-1");
  assert.equal(familyPick("opus", held), "opus");
});

test("modelPicks: Fable first; the current one by Claude's name", () => {
  const picks = modelPicks({ alias: "opus", label: "Opus 5.5 (1M context)" });
  assert.deepEqual(
    picks.map((p) => [p.alias, p.label, p.caption]),
    [
      ["fable", "Fable 5.2", "Most capable"],
      ["opus", "Opus 5.5 (1M context)", "Current"],
      ["sonnet", "Sonnet 5.5", "Faster"],
      ["haiku", "Haiku 5.5", "Quickest"],
    ]
  );
  const unknown = modelPicks({ alias: null, label: null });
  assert.ok(unknown.every((p) => p.caption !== "Current"));
});

test("modelAlias: Fable from its id and its name", () => {
  assert.equal(modelAlias("claude-fable-5-2"), "fable");
  assert.equal(modelAlias("Fable 5.2"), "fable");
});

test("sub-agent picks: Same, then each model by family", () => {
  assert.deepEqual(SUBAGENT_PICKS.map(subagentPickLabel), [
    "Same",
    "Fable",
    "Opus",
    "Sonnet",
    "Haiku",
  ]);
  assert.equal(currentSubagents(null), "same");
  assert.equal(currentSubagents("opus"), "opus");
  assert.equal(currentSubagents("claude-opus-5-5"), "same");
  assert.equal(currentSubagents("claude-opus-4-8"), "claude-opus-4-8");
  assert.equal(subagentSegment("claude-opus-4-8"), "opus");
  assert.equal(subagentSegment("same"), "same");
});

test("effortOptions: the mock's four, X-High only while in use", () => {
  assert.deepEqual(effortOptions("high"), ["low", "medium", "high", "max"]);
  assert.deepEqual(effortOptions(null, "xhigh"), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});

test("currentEffort: status line, then stored, ignoring unknown levels", () => {
  assert.equal(currentEffort("max", "low"), "max");
  assert.equal(currentEffort(undefined, "low"), "low");
  assert.equal(currentEffort("turbo", null), null);
});

const base = {
  source: "claude",
  sourceName: "Claude",
  picked: "claude",
  pickedName: "Claude",
  modelLabel: "Sonnet",
  modelChanged: false,
  effortChanged: false,
  busy: false,
  paused: false,
};

test("switchAction: another agent is a handoff that waits while busy", () => {
  const free = switchAction({ ...base, picked: "codex", pickedName: "Codex" });
  assert.equal(free.kind, "handoff");
  assert.equal(free.label, "Hand off to Codex");
  assert.equal(free.disabled, false);
  const busy = switchAction({
    ...base,
    picked: "codex",
    pickedName: "Codex",
    busy: true,
  });
  assert.equal(busy.disabled, true);
  assert.equal(busy.note, "Waits until Claude is done");
});

test("switchAction: same Claude, a model switch or Apply, queued if busy", () => {
  const model = switchAction({ ...base, modelChanged: true, busy: true });
  assert.equal(model.kind, "model");
  assert.equal(model.label, "Switch to Sonnet");
  assert.equal(model.disabled, false);
  assert.equal(model.note, "Switches when Claude is done");
  const effort = switchAction({ ...base, effortChanged: true });
  assert.equal(effort.kind, "model");
  assert.equal(effort.label, "Apply");
  const nothing = switchAction(base);
  assert.equal(nothing.kind, "none");
  assert.equal(nothing.disabled, true);
});

test("switchAction: Codex staying Codex has nothing to apply; paused nothing at all", () => {
  const codex = switchAction({
    ...base,
    source: "codex",
    sourceName: "Codex",
    picked: "codex",
    pickedName: "Codex",
    modelChanged: true,
  });
  assert.equal(codex.kind, "none");
  const paused = switchAction({
    ...base,
    picked: "gemini",
    pickedName: "Gemini",
    paused: true,
  });
  assert.equal(paused.kind, "none");
  assert.equal(paused.disabled, true);
});

test("modelRowCaption: the mock's words when another agent is picked", () => {
  assert.equal(
    modelRowCaption({ source: "claude", picked: "codex", pickedName: "Codex" }),
    "Not used while Codex is picked. Pick Claude to change the model on your next turn."
  );
  assert.equal(
    modelRowCaption({
      source: "claude",
      picked: "claude",
      pickedName: "Claude",
    }),
    null
  );
});

test("handoffRefusalText: reasons in words, 501 until the routes land", () => {
  assert.equal(
    handoffRefusalText(409, { error: "busy", reason: "busy" }, "Claude"),
    "Claude is working: try again once it's done"
  );
  assert.equal(
    handoffRefusalText(501, { error: "Not implemented" }, "Claude"),
    "Not available yet on this server"
  );
  assert.equal(
    handoffRefusalText(
      403,
      { error: "user_only", reason: "no_proof" },
      "Claude"
    ),
    "Reload to confirm it's you"
  );
  assert.equal(handoffRefusalText(500, null, "Claude"), "Something went wrong");
});

test("switchAction: sub-agents changed is a restart, never mid-turn", () => {
  const idle = switchAction({ ...base, subagentsChanged: true });
  assert.equal(idle.kind, "restart");
  assert.equal(idle.label, "Apply and restart");
  assert.equal(idle.disabled, false);
  assert.match(idle.note ?? "", /same conversation/);
  const busy = switchAction({
    ...base,
    subagentsChanged: true,
    modelChanged: true,
    busy: true,
  });
  assert.equal(busy.kind, "restart");
  assert.equal(busy.disabled, true);
  assert.match(busy.note ?? "", /Waits until/);
});
