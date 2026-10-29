import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Session } from "../../lib/db";
import { sendText } from "../../lib/tmux-send";

const session = (over: Partial<Session> = {}) =>
  ({
    id: "4b1c2d3e-0000-4000-8000-000000000001",
    agent_type: "claude",
    tmux_name: null,
    ...over,
  }) as Session;

/** Records each tmux call; on load-buffer, what the file held and its mode */
function recorder(fail?: string) {
  const calls: string[][] = [];
  const loaded: { text: string; mode: number; file: string }[] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "load-buffer") {
      const file = args[3];
      loaded.push({
        file,
        text: fs.readFileSync(file, "utf8"),
        mode: fs.statSync(file).mode & 0o777,
      });
    }
    if (args[0] === fail) throw new Error(`${fail} failed`);
  };
  return { run, calls, loaded };
}

describe("sendText", () => {
  test("pastes through its own buffer into the real tmux name", async () => {
    const r = recorder();
    await sendText(
      session({ tmux_name: "my-custom-name" }),
      "hello\nworld",
      {},
      r.run
    );
    const buffer = r.calls[1][2];
    assert.match(
      buffer,
      /^send-4b1c2d3e-0000-4000-8000-000000000001-[0-9a-f]{8}$/
    );
    assert.deepEqual(r.calls, [
      ["has-session", "-t", "=my-custom-name"],
      ["load-buffer", "-b", buffer, r.loaded[0].file],
      ["paste-buffer", "-d", "-b", buffer, "-t", "=my-custom-name:"],
      ["send-keys", "-t", "=my-custom-name:", "Enter"],
    ]);
    assert.equal(r.loaded[0].text, "hello\nworld");
    assert.equal(r.loaded[0].mode, 0o600);
    // The temp file is gone afterwards
    assert.equal(fs.existsSync(r.loaded[0].file), false);
  });

  test("falls back to agent-id for sessions without a tmux name", async () => {
    const r = recorder();
    await sendText(
      session({ agent_type: "codex" }),
      "hi",
      { pressEnter: false },
      r.run
    );
    assert.deepEqual(r.calls[0], [
      "has-session",
      "-t",
      "=codex-4b1c2d3e-0000-4000-8000-000000000001",
    ]);
    // No Enter when not asked
    assert.ok(!r.calls.some((c) => c[0] === "send-keys"));
  });

  test("text with shell metacharacters stays one argv-free file", async () => {
    const r = recorder();
    const text = `$(rm -rf /) "quoted" 'single' \`tick\``;
    await sendText(session(), text, {}, r.run);
    assert.equal(r.loaded[0].text, text);
    for (const call of r.calls) assert.ok(!call.includes(text));
  });

  test("a gone session rejects before writing anything", async () => {
    const r = recorder("has-session");
    await assert.rejects(sendText(session(), "x", {}, r.run));
    assert.equal(r.calls.length, 1);
  });

  test("a failed paste drops the buffer and the temp file", async () => {
    const r = recorder("paste-buffer");
    await assert.rejects(sendText(session(), "x", {}, r.run));
    assert.deepEqual(r.calls.at(-1)?.slice(0, 2), ["delete-buffer", "-b"]);
    assert.equal(fs.existsSync(r.loaded[0].file), false);
  });
});
