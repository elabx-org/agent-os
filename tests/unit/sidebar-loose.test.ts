import assert from "node:assert/strict";
import { test } from "node:test";
import { looseSessions } from "../../components/Sidebar/model";

const s = (
  id: string,
  over: Partial<{
    project_id: string | null;
    conductor_session_id: string | null;
    updated_at: string;
    agent_type: string;
  }> = {}
) => ({
  id,
  project_id: "uncategorized" as string | null,
  conductor_session_id: null as string | null,
  updated_at: "2026-11-23T10:00:00Z",
  agent_type: "claude",
  ...over,
});

const projects = [
  { id: "uncategorized", is_uncategorized: true },
  { id: "p1", is_uncategorized: false },
];

test("sidebar: quiet sessions outside any project are listed, newest first", () => {
  const sessions = [
    s("old", { updated_at: "2026-11-20T10:00:00Z" }),
    s("new", { updated_at: "2026-11-23T12:00:00Z" }),
    s("none", { project_id: null, updated_at: "2026-11-22T10:00:00Z" }),
    s("in-project", { project_id: "p1" }),
    s("worker", { conductor_session_id: "new" }),
    s("working"),
    s("dead-shell", { agent_type: "shell" }),
    s("live-shell", {
      agent_type: "shell",
      updated_at: "2026-11-19T10:00:00Z",
    }),
  ];
  const statuses = {
    "live-shell": { status: "idle" as const },
    "dead-shell": { status: "dead" as const },
  };
  const got = looseSessions(
    sessions as never,
    projects as never,
    statuses as never,
    new Set(["working"])
  ).map((x) => x.id);
  assert.deepEqual(got, ["new", "none", "old", "live-shell"]);
});
