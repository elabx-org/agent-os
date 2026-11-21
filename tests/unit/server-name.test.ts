import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeServerName, serverNameOr } from "../../lib/server-name";

test("a server name is one trimmed line, or nothing", () => {
  assert.equal(normalizeServerName("  Unraid  "), "Unraid");
  assert.equal(normalizeServerName("Home\n  server\t1"), "Home server 1");
  assert.equal(normalizeServerName(""), null);
  assert.equal(normalizeServerName("   "), null);
  assert.equal(normalizeServerName(42), null);
  assert.equal(normalizeServerName(null), null);
  assert.equal(normalizeServerName("x".repeat(90))!.length, 40);
});

test("without a name it reads as the server", () => {
  assert.equal(serverNameOr(null), "the server");
  assert.equal(serverNameOr(" "), "the server");
  assert.equal(serverNameOr(undefined, "This server"), "This server");
  assert.equal(serverNameOr("Unraid", "This server"), "Unraid");
});

test("a tab with no choice starts where the browser last was", async () => {
  const { machineToRestore } = await import("../../lib/machine-marker");
  assert.equal(machineToRestore(null, "m_0123456789ab"), "m_0123456789ab");
  // It chose this server, or a machine: another tab's pick doesn't move it
  assert.equal(machineToRestore("hub", "m_0123456789ab"), null);
  assert.equal(machineToRestore("m_aaaaaaaaaaaa", "m_0123456789ab"), null);
  assert.equal(machineToRestore(null, null), null);
  assert.equal(machineToRestore(null, "nonsense"), null);
});
