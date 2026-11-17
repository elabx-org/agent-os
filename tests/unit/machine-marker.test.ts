import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HUB_TARGET,
  cookieAssignment,
  headerFor,
  inviteHasSignIn,
  isMachineGone,
  markedSocketUrl,
  markerFor,
  readCookie,
  shortCommand,
  switchHref,
} from "../../lib/machine-marker";
import {
  lastUsedByProject,
  mergeQuiet,
  otherMachinesNow,
  type MachineSource,
  type MachineTag,
} from "../../lib/machine-now";
import { otherTargets, type MachineView } from "../../data/machines";
import type { Session } from "../../lib/db/types";

// lib/link/server.ts reads the flags from the database when asked
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-machine-ui-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

const MAC = "m_0123456789ab";
const HOST = "agentos.example:3011";
const url = (p: string) => new URL(p, `https://${HOST}`);

describe("the tab's marker on a call", () => {
  test("API and socket paths on this server carry the tab's machine", () => {
    assert.equal(headerFor(url("/api/sessions"), HOST, MAC, null), MAC);
    assert.equal(headerFor(url("/ws/terminal?x=1"), HOST, MAC, MAC), MAC);
  });

  test("nothing on this server with no machine anywhere: a no-op", () => {
    assert.equal(headerFor(url("/api/sessions"), HOST, null, null), null);
    assert.equal(markerFor(null, null), null);
  });

  test("another tab's cookie: this tab says it stays on the server", () => {
    assert.equal(headerFor(url("/api/sessions"), HOST, null, MAC), HUB_TARGET);
  });

  test("pages, assets, /m/ paths and other hosts are left alone", () => {
    assert.equal(headerFor(url("/"), HOST, MAC, MAC), null);
    assert.equal(headerFor(url("/_next/static/x.js"), HOST, MAC, MAC), null);
    assert.equal(
      headerFor(url(`/m/${MAC}/api/sessions`), HOST, MAC, MAC),
      null
    );
    assert.equal(
      headerFor(new URL("https://api.github.com/api/x"), HOST, MAC, MAC),
      null
    );
  });

  test("a stored value that isn't a machine id is ignored", () => {
    assert.equal(markerFor("hub", null), null);
    assert.equal(markerFor("m_nothex", null), null);
  });
});

describe("a socket's address", () => {
  const base = `https://${HOST}/`;
  test("adds machine=<id> to our sockets", () => {
    const out = markedSocketUrl(
      `wss://${HOST}/ws/terminal?cols=80`,
      base,
      HOST,
      MAC,
      null
    );
    assert.equal(out, `wss://${HOST}/ws/terminal?cols=80&machine=${MAC}`);
  });

  test("keeps a target the caller named, and other hosts' sockets", () => {
    assert.equal(
      markedSocketUrl(
        `wss://${HOST}/ws/terminal?machine=hub`,
        base,
        HOST,
        MAC,
        null
      ),
      null
    );
    assert.equal(
      markedSocketUrl("wss://elsewhere/ws/terminal", base, HOST, MAC, null),
      null
    );
    assert.equal(
      markedSocketUrl(`wss://${HOST}/ws/terminal`, base, HOST, null, null),
      null
    );
  });
});

describe("the cookie", () => {
  test("reads it among others", () => {
    assert.equal(
      readCookie(`a=1; agentos_machine=${MAC}; b=2`, "agentos_machine"),
      MAC
    );
    assert.equal(readCookie("a=1", "agentos_machine"), null);
  });

  test("sets it for a machine and clears it for this server", () => {
    assert.equal(
      cookieAssignment(MAC),
      `agentos_machine=${MAC}; Path=/; SameSite=Strict`
    );
    assert.match(
      cookieAssignment(null),
      /^agentos_machine=; Path=\/; Max-Age=0/
    );
    assert.match(cookieAssignment("hub"), /Max-Age=0/);
  });
});

describe("switching and errors", () => {
  test("the address a switch opens", () => {
    assert.equal(switchHref(), "/");
    assert.equal(switchHref({ session: "a b" }), "/?session=a%20b");
    assert.equal(switchHref({ project: "p1" }), "/?project=p1");
  });

  test("only the link's own errors mean the machine is gone", () => {
    assert.equal(isMachineGone(503, { code: "machine_offline" }), true);
    assert.equal(isMachineGone(404, { code: "machine_unknown" }), true);
    assert.equal(isMachineGone(502, { code: "machine_unreachable" }), true);
    assert.equal(isMachineGone(404, { error: "Session not found" }), false);
    assert.equal(isMachineGone(200, { code: "machine_offline" }), false);
  });
});

describe("the install command", () => {
  const invite = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const command = (value: object) =>
    `curl -fsSL https://raw.githubusercontent.com/elabx-org/agent-os/main/scripts/link-machine.sh | bash -s -- ${invite(value)}`;

  test("shortened for the screen", () => {
    const text = shortCommand(command({ hubUrl: "https://x", code: "ABCDEF" }));
    assert.match(text, /^curl -fsSL …\/link-machine\.sh \| bash -s -- \S{6}…$/);
  });

  test("says whether the Mac will be asked to sign in", () => {
    assert.equal(
      inviteHasSignIn(
        command({
          hubUrl: "https://x",
          code: "ABCDEF",
          signIn: { issuer: "https://auth", clientId: "c" },
        })
      ),
      true
    );
    assert.equal(
      inviteHasSignIn(command({ hubUrl: "https://x", code: "ABCDEF" })),
      false
    );
    assert.equal(inviteHasSignIn("curl nothing"), null);
  });
});

function session(id: string, fields: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    project_id: null,
    updated_at: "2026-11-17T10:00:00Z",
    conductor_session_id: null,
    agent_type: "claude",
    ...fields,
  } as Session;
}

const macTag: MachineTag = { target: MAC, name: "MacBook", kind: "mac" };

describe("Now's rows from another machine", () => {
  const source: MachineSource = {
    tag: macTag,
    sessions: [
      session("waits", {
        project_id: "p1",
        updated_at: "2026-11-17T09:00:00Z",
      }),
      session("works", {
        project_id: "p2",
        updated_at: "2026-11-17T11:00:00Z",
      }),
      session("idle", { project_id: "p3", updated_at: "2026-11-17T08:00:00Z" }),
      session("worker", { conductor_session_id: "works" }),
      session("handed", { paused_at: 1 }),
    ],
    statuses: {
      waits: { status: "waiting" },
      works: { status: "running", lastLine: "  Editing app.ts  " },
      idle: { status: "idle" },
      worker: { status: "waiting" },
      handed: { status: "waiting" },
    },
    projects: [
      { id: "p1", name: "one" },
      { id: "p2", name: "two" },
      { id: "p3", name: "three" },
      { id: "p4", name: "four" },
      { id: "u", name: "Uncategorized", is_uncategorized: 1 },
    ],
  };
  const now = otherMachinesNow([source]);

  test("waiting and working sessions, tagged; workers and handed-off left out", () => {
    assert.deepEqual(
      now.needs.map((r) => [r.session.id, r.tag.name, r.project]),
      [["waits", "MacBook", "one"]]
    );
    assert.deepEqual(
      now.working.map((r) => [r.session.id, r.line]),
      [["works", "Editing app.ts"]]
    );
  });

  test("quiet projects: not busy, not Uncategorized, last used first", () => {
    assert.deepEqual(
      now.quiet.map((q) => q.project.id),
      ["p3", "p4"]
    );
  });
});

describe("merging quiet projects", () => {
  test("by last use, this server's keeping their order", () => {
    const local = [{ id: "a" }, { id: "b" }];
    const lastUsed = new Map([
      ["a", "2026-11-17T10:00:00Z"],
      ["b", "2026-11-15T10:00:00Z"],
    ]);
    const merged = mergeQuiet(local, lastUsed, [
      {
        tag: macTag,
        project: { id: "x", name: "x" },
        lastUsed: "2026-11-16T00:00:00Z",
      },
      { tag: macTag, project: { id: "y", name: "y" }, lastUsed: "" },
    ]);
    assert.deepEqual(
      merged.map((e) =>
        e.kind === "local" ? e.project.id : e.item.project.id
      ),
      ["a", "x", "b", "y"]
    );
  });

  test("each project's latest session", () => {
    const map = lastUsedByProject([
      session("1", { project_id: "p", updated_at: "1" }),
      session("2", { project_id: "p", updated_at: "3" }),
      session("3", { project_id: null, updated_at: "9" }),
    ]);
    assert.deepEqual([...map], [["p", "3"]]);
  });
});

describe("where else Now reads", () => {
  const machine = (id: string, fields: Partial<MachineView> = {}) =>
    ({
      id,
      name: id,
      status: "approved",
      presence: "online",
      ...fields,
    }) as MachineView;
  const data = {
    enabled: true,
    machines: [
      machine(MAC),
      machine("m_111111111111", { presence: "offline" }),
      machine("m_222222222222", { status: "pending", presence: "waiting" }),
    ],
  };

  test("on this server: the online, approved machines", () => {
    assert.deepEqual(
      otherTargets(data, null).map((t) => t.target),
      [MAC]
    );
  });

  test("on a machine: this server, and not the machine itself", () => {
    assert.deepEqual(otherTargets(data, MAC), [
      { target: HUB_TARGET, name: "Server", kind: "server" },
    ]);
  });

  test("off: nowhere", () => {
    assert.deepEqual(otherTargets({ enabled: false, machines: [] }, null), []);
    assert.deepEqual(otherTargets(undefined, null), []);
  });
});

describe("the server agrees", () => {
  let server: typeof import("../../lib/link/server");
  before(async () => {
    server = await import("../../lib/link/server");
  });

  test('"hub" sends a call to this server, not a machine', () => {
    assert.equal(server.machineTarget("/api/sessions", "", HUB_TARGET), null);
    assert.equal(server.machineTarget("/ws/terminal", "", HUB_TARGET), null);
  });

  test("the names match", () => {
    assert.equal(server.MACHINE_HEADER, "x-agentos-machine");
    assert.equal(server.MACHINE_COOKIE, "agentos_machine");
    assert.equal(server.MACHINE_QUERY, "machine");
    assert.deepEqual(server.machineTarget("/api/sessions", "?a=1", MAC), {
      machineId: MAC,
      path: "/api/sessions?a=1",
    });
  });
});
