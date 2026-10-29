import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "../../lib/db";
import {
  MODES,
  effectiveMode,
  flagsFor,
  normalizeMode,
  parseLaunchCaps,
  type Mode,
} from "../../lib/permission-mode";

// Written against the plan's table while lib/permission-mode.ts is a stub
const stub = (() => {
  try {
    normalizeMode("manual");
    return false;
  } catch {
    return "lib/permission-mode.ts is a stub until U0.2 lands";
  }
})();

/** The M0 provider mapping, flags joined as they go into the command */
const TABLE: Record<"claude" | "codex" | "gemini", Record<Mode, string>> = {
  claude: {
    manual: "--permission-mode manual",
    acceptEdits: "--permission-mode acceptEdits",
    auto: "--permission-mode auto",
    bypassPermissions: "--dangerously-skip-permissions",
  },
  codex: {
    manual: "-a untrusted",
    acceptEdits: "--full-auto",
    auto: "--full-auto",
    bypassPermissions: "--dangerously-bypass-approvals-and-sandbox",
  },
  gemini: {
    manual: "--approval-mode default",
    acceptEdits: "--approval-mode auto_edit",
    auto: "--approval-mode auto_edit",
    bypassPermissions: "--yolo",
  },
};

const session = (fields: Partial<Session>) =>
  ({ auto_approve: false, permission_mode: null, ...fields }) as Session;

describe("flagsFor", { skip: stub }, () => {
  for (const [agent, row] of Object.entries(TABLE)) {
    for (const mode of MODES) {
      test(`${agent} ${mode}`, () => {
        assert.equal(
          flagsFor(agent as keyof typeof TABLE, mode).join(" "),
          row[mode]
        );
      });
    }
    test(`${agent} with no mode adds nothing`, () => {
      assert.deepEqual(flagsFor(agent as keyof typeof TABLE, null), []);
    });
  }

  test("never offers bypass through the Shift+Tab cycle", () => {
    for (const agent of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
      for (const mode of MODES) {
        assert.ok(
          !flagsFor(agent, mode).join(" ").includes("allow-dangerously"),
          `${agent} ${mode}`
        );
      }
    }
  });
});

describe("normalizeMode", { skip: stub }, () => {
  test("known modes pass, Claude's default is manual, others are null", () => {
    for (const mode of MODES) assert.equal(normalizeMode(mode), mode);
    assert.equal(normalizeMode("default"), "manual");
    for (const value of ["plan", "dontAsk", "", "BYPASS", null, 1, {}]) {
      assert.equal(normalizeMode(value), null, String(value));
    }
  });
});

describe("effectiveMode", { skip: stub }, () => {
  test("the stored mode, else auto_approve, else manual", () => {
    assert.equal(effectiveMode(session({ permission_mode: "auto" })), "auto");
    assert.equal(
      effectiveMode(session({ auto_approve: true })),
      "bypassPermissions"
    );
    assert.equal(effectiveMode(session({})), "manual");
    assert.equal(effectiveMode(session({ permission_mode: "junk" })), "manual");
  });
});

describe("parseLaunchCaps", { skip: stub }, () => {
  test("all false when missing or malformed", () => {
    for (const raw of [null, "", "{", "[]", '{"allowBypassCycle":"yes"}']) {
      assert.deepEqual(
        parseLaunchCaps(raw),
        { allowBypassCycle: false },
        String(raw)
      );
    }
    assert.deepEqual(parseLaunchCaps('{"allowBypassCycle":true}'), {
      allowBypassCycle: true,
    });
  });
});
