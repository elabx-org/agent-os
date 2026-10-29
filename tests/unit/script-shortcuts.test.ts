import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  formatShortcut,
  isReservedShortcut,
  matchesShortcut,
  parseShortcut,
  shortcutFromEvent,
  shortcutText,
  type ShortcutSpec,
} from "../../lib/script-shortcuts";
import {
  ago,
  lastRunText,
  previewPort,
  previewScriptId,
  runningText,
  splitScripts,
  stripAnsi,
} from "../../components/Projects/script-view";
import type { ProjectScript, ScriptRun } from "../../lib/project-config-types";

const spec = (over: Partial<ShortcutSpec>): ShortcutSpec => ({
  mod: false,
  shift: false,
  alt: false,
  key: "T",
  ...over,
});

const key = (
  over: Partial<{
    key: string;
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }>
) => ({
  key: "t",
  code: "KeyT",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("parseShortcut", () => {
  test("reads the stored form", () => {
    assert.deepEqual(
      parseShortcut("Cmd+Shift+T"),
      spec({ mod: true, shift: true })
    );
  });

  test("Ctrl, Command and Meta are all the mod key; case and spaces don't matter", () => {
    for (const text of ["ctrl+shift+t", "Command + Shift + T", "Meta+Shift+t"])
      assert.deepEqual(parseShortcut(text), spec({ mod: true, shift: true }));
  });

  test("Alt and Option", () => {
    assert.deepEqual(parseShortcut("Option+5"), spec({ alt: true, key: "5" }));
    assert.deepEqual(
      parseShortcut("Alt+Shift+D"),
      spec({ alt: true, shift: true, key: "D" })
    );
  });

  test("reads the glyph form as shown", () => {
    assert.deepEqual(parseShortcut("⌘⇧T"), spec({ mod: true, shift: true }));
    assert.deepEqual(parseShortcut("⌥B"), spec({ alt: true, key: "B" }));
  });

  test("refuses what isn't one modifier set and one letter or digit", () => {
    for (const text of [
      undefined,
      "",
      "T",
      "Shift+T",
      "Cmd+",
      "Cmd+Shift",
      "Cmd+F5",
      "Cmd+Enter",
      "Hyper+T",
      "Cmd+T+X",
      "CmdT",
    ])
      assert.equal(parseShortcut(text), null, String(text));
  });
});

describe("shortcutText and formatShortcut", () => {
  test("round-trips through the stored text", () => {
    for (const text of ["Cmd+Shift+T", "Cmd+Alt+Shift+1", "Alt+B", "Cmd+K"]) {
      const parsed = parseShortcut(text)!;
      assert.equal(shortcutText(parsed), text);
      assert.deepEqual(parseShortcut(shortcutText(parsed)), parsed);
    }
  });

  test("glyphs on a Mac, words elsewhere", () => {
    const s = spec({ mod: true, shift: true });
    assert.equal(formatShortcut(s, true), "⌘⇧T");
    assert.equal(formatShortcut(s, false), "Ctrl+Shift+T");
    assert.equal(
      formatShortcut(spec({ mod: true, alt: true, key: "2" }), true),
      "⌘⌥2"
    );
    assert.equal(formatShortcut(spec({ alt: true, key: "2" }), false), "Alt+2");
  });
});

describe("shortcutFromEvent", () => {
  test("Cmd on a Mac, Ctrl elsewhere", () => {
    const mac = key({ metaKey: true, shiftKey: true, key: "T" });
    assert.deepEqual(
      shortcutFromEvent(mac, true),
      spec({ mod: true, shift: true })
    );
    const pc = key({ ctrlKey: true, shiftKey: true, key: "T" });
    assert.deepEqual(
      shortcutFromEvent(pc, false),
      spec({ mod: true, shift: true })
    );
  });

  test("the other modifier isn't Cmd: Ctrl on a Mac, the Windows key elsewhere", () => {
    assert.equal(shortcutFromEvent(key({ ctrlKey: true }), true), null);
    assert.equal(shortcutFromEvent(key({ metaKey: true }), false), null);
  });

  test("goes by the key's place, so Shift and Option don't change it", () => {
    assert.deepEqual(
      shortcutFromEvent(
        key({ metaKey: true, shiftKey: true, key: "!", code: "Digit1" }),
        true
      ),
      spec({ mod: true, shift: true, key: "1" })
    );
    assert.deepEqual(
      shortcutFromEvent(key({ altKey: true, key: "†", code: "KeyT" }), true),
      spec({ alt: true })
    );
  });

  test("a bare key, Shift alone and a modifier on its own record nothing", () => {
    assert.equal(shortcutFromEvent(key({}), true), null);
    assert.equal(
      shortcutFromEvent(key({ shiftKey: true, key: "T" }), true),
      null
    );
    assert.equal(
      shortcutFromEvent(
        key({ metaKey: true, key: "Meta", code: "MetaLeft" }),
        true
      ),
      null
    );
    assert.equal(
      shortcutFromEvent(
        key({ metaKey: true, key: "Enter", code: "Enter" }),
        true
      ),
      null
    );
  });
});

describe("matchesShortcut", () => {
  const s = parseShortcut("Cmd+Shift+T")!;

  test("matches exactly the modifiers it names", () => {
    assert.ok(matchesShortcut(key({ metaKey: true, shiftKey: true }), s, true));
    assert.ok(
      matchesShortcut(key({ ctrlKey: true, shiftKey: true }), s, false)
    );
    assert.ok(!matchesShortcut(key({ metaKey: true }), s, true));
    assert.ok(
      !matchesShortcut(
        key({ metaKey: true, shiftKey: true, altKey: true }),
        s,
        true
      )
    );
    assert.ok(
      !matchesShortcut(key({ ctrlKey: true, shiftKey: true }), s, true)
    );
    assert.ok(
      !matchesShortcut(
        key({ metaKey: true, shiftKey: true, code: "KeyR", key: "R" }),
        s,
        true
      )
    );
  });
});

describe("isReservedShortcut", () => {
  test("the app's ⌘ keys without Shift or Alt", () => {
    for (const k of ["1", "2", "3", "4", "K", "I", "N"])
      assert.ok(isReservedShortcut(spec({ mod: true, key: k })), k);
    assert.ok(
      isReservedShortcut(spec({ alt: true, key: "N" })),
      "Alt+N is New"
    );
  });

  test("with Shift, other digits and other letters they're free", () => {
    assert.ok(!isReservedShortcut(spec({ mod: true, shift: true, key: "K" })));
    assert.ok(!isReservedShortcut(spec({ mod: true, key: "5" })));
    assert.ok(!isReservedShortcut(spec({ mod: true, key: "T" })));
    assert.ok(!isReservedShortcut(spec({ mod: true, alt: true, key: "N" })));
  });
});

// script-view: what the Scripts sheet says about a script

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const min = 60_000;

const script = (
  id: string,
  over: Partial<ProjectScript> = {}
): ProjectScript => ({
  id,
  name: id,
  command: `npm run ${id}`,
  ...over,
});

const run = (scriptId: string, over: Partial<ScriptRun> = {}): ScriptRun => ({
  id: `run-${scriptId}`,
  project_id: "p",
  script_id: scriptId,
  command: "x",
  status: "passed",
  exit_code: 0,
  pid: null,
  log_path: "/tmp/x.log",
  started_at: NOW - 25 * min,
  finished_at: NOW - 20 * min,
  ...over,
});

describe("script-view", () => {
  test("lastRunText: passed, failed, stopped, never", () => {
    assert.equal(lastRunText(run("lint"), NOW), "Passed 20m ago");
    assert.equal(
      lastRunText(
        run("t", {
          status: "failed",
          exit_code: 1,
          finished_at: NOW - 2 * 60 * min,
        }),
        NOW
      ),
      "Failed 2h ago"
    );
    assert.equal(
      lastRunText(
        run("d", { status: "stopped", finished_at: NOW - 10_000 }),
        NOW
      ),
      "Last run just now"
    );
    assert.equal(lastRunText(undefined, NOW), null);
    assert.equal(
      lastRunText(run("dev", { status: "running", finished_at: null }), NOW),
      null
    );
  });

  test("ago falls back to the start time's age", () => {
    assert.equal(ago(NOW - 3 * 24 * 60 * min, NOW), "3d ago");
  });

  test("splitScripts keeps the file's order and puts running ones apart, oldest first", () => {
    const scripts = [
      script("dev"),
      script("test"),
      script("lint"),
      script("watch"),
    ];
    const runs = {
      dev: run("dev", {
        status: "running",
        started_at: NOW - 14 * min,
        finished_at: null,
      }),
      watch: run("watch", {
        status: "running",
        started_at: NOW - 30 * min,
        finished_at: null,
      }),
      lint: run("lint"),
      gone: run("gone"),
    };
    const { running, idle } = splitScripts(scripts, runs);
    assert.deepEqual(
      running.map((e) => e.script.id),
      ["watch", "dev"]
    );
    assert.deepEqual(
      idle.map((e) => e.script.id),
      ["test", "lint"]
    );
    assert.equal(idle[1].run?.status, "passed");
    assert.deepEqual(splitScripts(undefined, undefined), {
      running: [],
      idle: [],
    });
  });

  test("previewPort", () => {
    assert.equal(previewPort("http://localhost:3000/"), ":3000");
    assert.equal(previewPort("https://example.test"), null);
    assert.equal(previewPort("not a url"), null);
    assert.equal(previewPort(undefined), null);
  });

  test("previewScriptId: the server-looking script, else the only one running", () => {
    const entries = (...s: ProjectScript[]) =>
      s.map((x) => ({ script: x, run: run(x.id) }));
    const url = "http://localhost:3000";
    assert.equal(
      previewScriptId(
        entries(script("test"), script("web", { icon: "monitor" })),
        url
      ),
      "web"
    );
    assert.equal(
      previewScriptId(
        entries(
          script("test", { command: "npm test" }),
          script("dev", { command: "npm run dev" })
        ),
        url
      ),
      "dev"
    );
    assert.equal(
      previewScriptId(entries(script("watch", { command: "tsc -w" })), url),
      "watch"
    );
    assert.equal(
      previewScriptId(
        entries(script("a", { command: "x" }), script("b", { command: "y" })),
        url
      ),
      null
    );
    assert.equal(previewScriptId(entries(script("dev")), undefined), null);
  });

  test("runningText: Running · :3000 · 14m", () => {
    const r = run("dev", { status: "running", started_at: NOW - 14 * min });
    assert.deepEqual(runningText(r, ":3000", NOW), ["Running", ":3000", "14m"]);
    assert.deepEqual(runningText({ ...r, started_at: NOW }, null, NOW), [
      "Running",
      "just now",
    ]);
  });

  test("stripAnsi drops colours, titles and carriage returns", () => {
    assert.equal(
      stripAnsi("\x1b[32m✓\x1b[0m Compiled in 812ms\r"),
      "✓ Compiled in 812ms"
    );
    assert.equal(stripAnsi("\x1b]0;title\x07GET /api 200"), "GET /api 200");
  });
});
