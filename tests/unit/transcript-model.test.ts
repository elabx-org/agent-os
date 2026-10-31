import { test } from "node:test";
import assert from "node:assert/strict";
import { lastModelIn, modelNameFromId } from "../../lib/transcript-model";

const line = (o: unknown) => JSON.stringify(o);

test("the last assistant model, past synthetic and partial lines", () => {
  const text = [
    '"model":"claude-cut',
    line({ type: "assistant", message: { model: "claude-sonnet-5-5" } }),
    line({ type: "user", message: { content: "hi" } }),
    line({ type: "assistant", message: { model: "claude-opus-5-5" } }),
    line({ type: "assistant", message: { model: "<synthetic>" } }),
    '{"type":"assistant","message":{"model":"claude-ha',
  ].join("\n");
  assert.equal(lastModelIn(text), "claude-opus-5-5");
});

test("no model without an assistant line", () => {
  assert.equal(lastModelIn(line({ type: "user", model: "claude-x" })), null);
  assert.equal(lastModelIn(""), null);
});

test("the family and version from a model id", () => {
  assert.equal(modelNameFromId("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelNameFromId("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
  assert.equal(modelNameFromId("claude-haiku-5-5[1m]"), "Haiku 5.5");
  assert.equal(modelNameFromId("claude-fable-5-1"), "Fable 5.1");
  assert.equal(modelNameFromId("claude-opus"), "Opus");
  assert.equal(modelNameFromId("123"), null);
});
