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
  modelRowCaption,
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
    { alias: "sonnet", label: "Sonnet 5.5" }
  );
  assert.deepEqual(currentModel(null, "haiku"), {
    alias: "haiku",
    label: "Haiku",
  });
  assert.deepEqual(currentModel(null, null), { alias: null, label: null });
});

test("modelPicks: the current one by Claude's name, the rest by family", () => {
  const picks = modelPicks({ alias: "opus", label: "Opus 5.5" });
  assert.deepEqual(
    picks.map((p) => [p.alias, p.label, p.caption]),
    [
      ["opus", "Opus 5.5", "Current"],
      ["sonnet", "Sonnet", "Faster"],
      ["haiku", "Haiku", "Quickest"],
    ]
  );
  // No version made up when nothing is known
  const unknown = modelPicks({ alias: null, label: null });
  assert.ok(unknown.every((p) => p.caption !== "Current"));
  assert.deepEqual(
    unknown.map((p) => p.label),
    ["Opus", "Sonnet", "Haiku"]
  );
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
