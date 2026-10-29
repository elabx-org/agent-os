import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "@/lib/db";
import {
  capForAgent,
  cycleToMode,
  effectiveMode,
  flagsFor,
  isEscalation,
  normalizeMode,
  parseLaunchCaps,
  permissionFlags,
} from "@/lib/permission-mode";
import { claudeProvider, codexProvider, geminiProvider } from "@/lib/providers";

const session = (fields: Partial<Session>) => fields as Session;

test("normalizeMode", () => {
  assert.equal(normalizeMode("default"), "manual");
  assert.equal(normalizeMode("manual"), "manual");
  assert.equal(normalizeMode("bypassPermissions"), "bypassPermissions");
  for (const junk of ["plan", "dontAsk", "", null, undefined, 1, {}]) {
    assert.equal(normalizeMode(junk), null);
  }
});

test("effectiveMode: stored, else auto_approve, else manual", () => {
  assert.equal(
    effectiveMode(session({ permission_mode: "auto", auto_approve: true })),
    "auto"
  );
  assert.equal(
    effectiveMode(session({ permission_mode: null, auto_approve: true })),
    "bypassPermissions"
  );
  // SQLite hands back 0/1
  assert.equal(
    effectiveMode(
      session({
        permission_mode: "junk",
        auto_approve: 0 as unknown as boolean,
      })
    ),
    "manual"
  );
});

test("escalation and the agent cap", () => {
  assert.equal(isEscalation("auto", "acceptEdits"), true);
  assert.equal(isEscalation("manual", "bypassPermissions"), false);
  assert.equal(isEscalation("auto", "auto"), false);
  assert.equal(capForAgent("bypassPermissions"), "auto");
  assert.equal(capForAgent("acceptEdits"), "acceptEdits");
});

test("parseLaunchCaps", () => {
  assert.deepEqual(parseLaunchCaps('{"allowBypassCycle":true}'), {
    allowBypassCycle: true,
  });
  for (const raw of [null, "", "{", '{"allowBypassCycle":"yes"}', "null"]) {
    assert.deepEqual(parseLaunchCaps(raw), { allowBypassCycle: false });
  }
});

test("flagsFor table", () => {
  const table: [string, string, string[]][] = [
    ["claude", "manual", ["--permission-mode", "manual"]],
    ["claude", "acceptEdits", ["--permission-mode", "acceptEdits"]],
    ["claude", "auto", ["--permission-mode", "auto"]],
    ["claude", "bypassPermissions", ["--dangerously-skip-permissions"]],
    ["minimax", "auto", ["--permission-mode", "auto"]],
    ["codex", "manual", ["-a", "untrusted"]],
    ["codex", "acceptEdits", ["--full-auto"]],
    ["codex", "auto", ["--full-auto"]],
    [
      "codex",
      "bypassPermissions",
      ["--dangerously-bypass-approvals-and-sandbox"],
    ],
    ["gemini", "manual", ["--approval-mode", "default"]],
    ["gemini", "acceptEdits", ["--approval-mode", "auto_edit"]],
    ["gemini", "auto", ["--approval-mode", "auto_edit"]],
    ["gemini", "bypassPermissions", ["--yolo"]],
    ["aider", "bypassPermissions", ["--yes"]],
    ["aider", "auto", []],
    ["cursor", "bypassPermissions", []],
    ["shell", "bypassPermissions", []],
  ];
  for (const [agent, mode, flags] of table) {
    assert.deepEqual(
      flagsFor(agent as never, mode as never),
      flags,
      `${agent} ${mode}`
    );
  }
  assert.deepEqual(flagsFor("claude", null), []);
});

test("permissionFlags: NULL mode keeps the old auto-approve behaviour", () => {
  assert.deepEqual(permissionFlags("claude", {}), []);
  assert.deepEqual(permissionFlags("claude", { autoApprove: true }), [
    "--dangerously-skip-permissions",
  ]);
  assert.deepEqual(permissionFlags("codex", { autoApprove: true }), [
    "--full-auto",
  ]);
  // A stored mode wins over auto_approve
  assert.deepEqual(
    permissionFlags("claude", { permissionMode: "manual", autoApprove: true }),
    ["--permission-mode", "manual"]
  );
  assert.deepEqual(
    permissionFlags("claude", {
      permissionMode: "auto",
      allowBypassCycle: true,
    }),
    ["--permission-mode", "auto", "--allow-dangerously-skip-permissions"]
  );
  assert.deepEqual(permissionFlags("claude", { allowBypassCycle: true }), [
    "--allow-dangerously-skip-permissions",
  ]);
  assert.deepEqual(
    permissionFlags("claude", {
      permissionMode: "bypassPermissions",
      allowBypassCycle: true,
    }),
    ["--dangerously-skip-permissions"]
  );
  assert.deepEqual(
    permissionFlags("codex", {
      permissionMode: "auto",
      allowBypassCycle: true,
    }),
    ["--full-auto"]
  );
});

test("buildFlags: backfilled full access launches as before", () => {
  // Migration 22 sets bypassPermissions where auto_approve = 1
  const before = claudeProvider.buildFlags({
    autoApprove: true,
    sessionId: "x",
  });
  const after = claudeProvider.buildFlags({
    autoApprove: true,
    permissionMode: "bypassPermissions",
    sessionId: "x",
  });
  assert.deepEqual(after, before);
  assert.equal(
    claudeProvider.buildFlags({ permissionMode: "acceptEdits" }).join(" "),
    "--permission-mode acceptEdits"
  );
  assert.equal(
    geminiProvider.buildFlags({ autoApprove: true }).join(" "),
    "--yolo"
  );
  assert.equal(
    codexProvider.buildFlags({ permissionMode: "manual" }).join(" "),
    "-a untrusted"
  );
});

/** Claude's Shift+Tab cycle, as a fake footer */
function fakeClaude(
  cycle: string[],
  start = 0,
  opts: { covered?: boolean } = {}
) {
  let i = start;
  let presses = 0;
  return {
    get presses() {
      return presses;
    },
    io: {
      read: async () => (opts.covered ? null : cycle[i]),
      press: async () => {
        presses++;
        i = (i + 1) % cycle.length;
      },
    },
  };
}

test("cycleToMode reaches a mode in the cycle", async () => {
  const claude = fakeClaude([
    "default",
    "acceptEdits",
    "plan",
    "auto",
    "bypassPermissions",
  ]);
  assert.deepEqual(await cycleToMode("bypassPermissions", claude.io), {
    applied: true,
    live: "bypassPermissions",
  });
  assert.equal(claude.presses, 4);
});

test("cycleToMode: already there presses nothing", async () => {
  const claude = fakeClaude(["default", "acceptEdits"]);
  assert.deepEqual(await cycleToMode("manual", claude.io), {
    applied: true,
    live: "manual",
  });
  assert.equal(claude.presses, 0);
});

test("cycleToMode stops where it started when the mode isn't in the cycle", async () => {
  // Launched without --allow-dangerously-skip-permissions
  const claude = fakeClaude(["default", "acceptEdits", "plan"], 1);
  assert.deepEqual(await cycleToMode("bypassPermissions", claude.io), {
    applied: false,
    live: "acceptEdits",
  });
  assert.equal(claude.presses, 3);
});

test("cycleToMode: bounded, and never presses into a dialog", async () => {
  const long = fakeClaude([
    "default",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "auto",
  ]);
  const result = await cycleToMode("auto", long.io);
  assert.equal(result.applied, false);
  assert.equal(long.presses, 6);

  const covered = fakeClaude(["default", "auto"], 0, { covered: true });
  assert.deepEqual(await cycleToMode("auto", covered.io), {
    applied: false,
    live: null,
  });
  assert.equal(covered.presses, 0);
});
