import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Session } from "../../lib/db";
import { sendText } from "../../lib/tmux-send";

const session = (over: Partial<Session> = {}) =>
  ({
    id: "4b1c2d3e-0000-4000-8000-000000000001",
    agent_type: "claude",
    tmux_name: null,
    ...over,
  }) as Session;

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "fixtures", "screens", name), "utf8");

/** No real waits between the paste, its Enter and the look after */
const noWait = async () => {};

/**
 * Records each tmux call; on load-buffer, what the file held and its mode.
 * capture-pane answers with the next of `screens`
 */
function recorder(fail?: string, screens: string[] = []) {
  const calls: string[][] = [];
  const loaded: { text: string; mode: number; file: string }[] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "capture-pane") return { stdout: screens.shift() ?? "" };
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
      { awaitConfirm: true },
      r.run,
      noWait
    );
    const buffer = r.calls[1][2];
    assert.match(
      buffer,
      /^send-4b1c2d3e-0000-4000-8000-000000000001-[0-9a-f]{8}$/
    );
    assert.deepEqual(r.calls, [
      ["has-session", "-t", "=my-custom-name"],
      ["load-buffer", "-b", buffer, r.loaded[0].file],
      // Bracketed, newlines kept: a multi-line text is one message
      [
        "paste-buffer",
        "-d",
        "-p",
        "-r",
        "-b",
        buffer,
        "-t",
        "=my-custom-name:",
      ],
      ["send-keys", "-t", "=my-custom-name:", "Enter"],
      // One look at Claude's box: empty, so it went
      ["capture-pane", "-p", "-e", "-t", "=my-custom-name:"],
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
      r.run,
      noWait
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
    await sendText(session(), text, {}, r.run, noWait);
    assert.equal(r.loaded[0].text, text);
    for (const call of r.calls) assert.ok(!call.includes(text));
  });

  test("a gone session rejects before writing anything", async () => {
    const r = recorder("has-session");
    await assert.rejects(sendText(session(), "x", {}, r.run, noWait));
    assert.equal(r.calls.length, 1);
  });

  test("a failed paste drops the buffer and the temp file", async () => {
    const r = recorder("paste-buffer");
    await assert.rejects(sendText(session(), "x", {}, r.run, noWait));
    assert.deepEqual(r.calls.at(-1)?.slice(0, 2), ["delete-buffer", "-b"]);
    assert.equal(fs.existsSync(r.loaded[0].file), false);
  });

  test("presses Enter again while the text sits in Claude's idle box", async () => {
    const typed = fixture("claude-typed.ansi");
    const r = recorder(undefined, [typed, typed]);
    await sendText(
      session(),
      "a long paste",
      { awaitConfirm: true },
      r.run,
      noWait
    );
    const enters = r.calls.filter((c) => c[0] === "send-keys").length;
    // The first Enter and two more, then it gives up
    assert.equal(enters, 3);
  });

  test("no second Enter once the box is empty", async () => {
    const r = recorder(undefined, [fixture("claude-idle.ansi")]);
    await sendText(session(), "hi", { awaitConfirm: true }, r.run, noWait);
    assert.equal(r.calls.filter((c) => c[0] === "send-keys").length, 1);
    assert.equal(r.calls.filter((c) => c[0] === "capture-pane").length, 1);
  });

  test("other agents get one Enter and no look at the screen", async () => {
    const r = recorder();
    await sendText(
      session({ agent_type: "codex" }),
      "hi",
      { awaitConfirm: true },
      r.run,
      noWait
    );
    assert.ok(!r.calls.some((c) => c[0] === "capture-pane"));
  });
});
