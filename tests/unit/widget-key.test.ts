import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AGENT_OS_HOME = mkdtempSync(path.join(tmpdir(), "agentos-widget-"));

import { isWidgetKey, newWidgetKey, widgetKey } from "../../lib/widget-key";

test("no key on disk matches nothing", () => {
  assert.equal(isWidgetKey(""), false);
  assert.equal(isWidgetKey("anything"), false);
});

test("the key is made once, kept private, and matched exactly", () => {
  const key = widgetKey();
  assert.equal(widgetKey(), key);
  const file = path.join(process.env.AGENT_OS_HOME!, "widget-key");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(isWidgetKey(key), true);
  assert.equal(isWidgetKey(key.slice(1)), false);
  assert.equal(isWidgetKey(null), false);
});

test("a new key stops the old one", () => {
  const old = widgetKey();
  const fresh = newWidgetKey();
  assert.notEqual(fresh, old);
  assert.equal(isWidgetKey(old), false);
  assert.equal(isWidgetKey(fresh), true);
});
