import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_TONES,
  groupProjects,
  projectStatusLine,
  projectTone,
  reorderWithin,
  type ProjectActivity,
} from "../../lib/project-groups";
import type { Project } from "../../lib/db/types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 29, 12);

function project(id: string, fields: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    working_directory: `~/${id}`,
    agent_type: "claude",
    default_model: "sonnet",
    initial_prompt: null,
    instructions: null,
    hooks: null,
    expanded: true,
    sort_order: 0,
    is_uncategorized: false,
    git_sync_interval: 0,
    pinned: false,
    group_name: null,
    created_at: "",
    updated_at: "",
    ...fields,
  };
}

const idle = (fields: Partial<ProjectActivity> = {}): ProjectActivity => ({
  needs: 0,
  work: 0,
  agents: 0,
  lastActiveAt: null,
  ...fields,
});

const names = (groups: { projects: Project[] }[]) =>
  groups.map((g) => g.projects.map((p) => p.id));

test("projectTone: the same project gets the same tone", () => {
  for (const id of ["proj_a", "proj_mf2k_9x1z", "uncategorized"])
    assert.equal(projectTone({ id }), projectTone({ id }));
});

test("projectTone: ids spread over every tone", () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 600; i++) {
    const tone = projectTone({ id: `proj_${i.toString(36)}_x${i % 7}` });
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }
  assert.equal(counts.size, PROJECT_TONES.length);
  for (const n of counts.values()) assert.ok(n > 50 && n < 150, `${n}`);
});

test("projectStatusLine: needs and working, needs leading", () => {
  assert.deepEqual(projectStatusLine(idle({ needs: 1, work: 1, agents: 2 })), {
    state: "needs",
    text: "1 needs you · 1 working",
  });
  assert.deepEqual(projectStatusLine(idle({ needs: 2, agents: 2 })), {
    state: "needs",
    text: "2 need you",
  });
  assert.deepEqual(projectStatusLine(idle({ work: 3, agents: 3 })), {
    state: "work",
    text: "3 working",
  });
});

test("projectStatusLine: quiet with how long", () => {
  const at = (ago: number) =>
    projectStatusLine(idle({ agents: 1, lastActiveAt: NOW - ago }), NOW);
  assert.deepEqual(at(2 * DAY + HOUR), { state: null, text: "Quiet · 2d" });
  assert.deepEqual(at(3 * HOUR + 5 * MIN), { state: null, text: "Quiet · 3h" });
  assert.equal(at(12 * MIN).text, "Quiet · 12m");
  assert.equal(at(10_000).text, "Quiet · now");
  // A clock a little behind the server's is still now
  assert.equal(at(-MIN).text, "Quiet · now");
});

test("projectStatusLine: never active is just Quiet", () => {
  assert.deepEqual(projectStatusLine(idle(), NOW), {
    state: null,
    text: "Quiet",
  });
});

test("groupProjects: Pinned, then groups in order, then the rest", () => {
  const projects = [
    project("herald", { sort_order: 6, group_name: "Home lab" }),
    project("agent-os", { sort_order: 1, pinned: true }),
    project("ios-cert", { sort_order: 3, group_name: "iOS" }),
    project("loose", { sort_order: 7 }),
    project("dcs", { sort_order: 2, pinned: true, group_name: "Home lab" }),
    project("komodo", { sort_order: 5, group_name: "Home lab" }),
    project("fusion", { sort_order: 4, group_name: "iOS" }),
  ];
  const groups = groupProjects(projects, {});
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Pinned", "iOS", "Home lab", null]
  );
  assert.equal(groups[0].pinned, true);
  assert.deepEqual(names(groups), [
    ["agent-os", "dcs"],
    ["ios-cert", "fusion"],
    ["komodo", "herald"],
    ["loose"],
  ]);
});

test("groupProjects: group names are trimmed, blank is no group", () => {
  const groups = groupProjects(
    [
      project("a", { sort_order: 1, group_name: " iOS " }),
      project("b", { sort_order: 2, group_name: "iOS" }),
      project("c", { sort_order: 3, group_name: "  " }),
    ],
    {}
  );
  assert.deepEqual(
    groups.map((g) => g.name),
    ["iOS", null]
  );
  assert.deepEqual(names(groups), [["a", "b"], ["c"]]);
});

test("groupProjects: empty groups are left out", () => {
  assert.deepEqual(groupProjects([], {}), []);
  const groups = groupProjects([project("a", { pinned: true })], {});
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Pinned"]
  );
});

test("groupProjects: Uncategorized last, only when it holds something", () => {
  const uncategorized = project("uncategorized", {
    is_uncategorized: true,
    sort_order: 0,
  });
  const rest = [
    project("a", { sort_order: 2 }),
    project("b", { sort_order: 1 }),
  ];
  assert.deepEqual(names(groupProjects([uncategorized, ...rest], {})), [
    ["b", "a"],
  ]);
  assert.deepEqual(
    names(
      groupProjects([uncategorized, ...rest], {
        uncategorized: idle({ agents: 1 }),
      })
    ),
    [["b", "a", "uncategorized"]]
  );
  // The only project shows even when empty
  assert.deepEqual(names(groupProjects([uncategorized], {})), [
    ["uncategorized"],
  ]);
  // Never pinned or grouped, whatever the row says
  assert.deepEqual(
    names(
      groupProjects(
        [{ ...uncategorized, pinned: true, group_name: "iOS" }, ...rest],
        { uncategorized: idle({ agents: 1 }) }
      )
    ),
    [["b", "a", "uncategorized"]]
  );
});

test("groupProjects: manual sort is sort_order", () => {
  const groups = groupProjects(
    [
      project("c", { sort_order: 3 }),
      project("a", { sort_order: 2 }),
      project("b", { sort_order: 1 }),
    ],
    {},
    "manual"
  );
  assert.deepEqual(names(groups), [["b", "a", "c"]]);
});

test("groupProjects: recent sort is latest activity first, never last", () => {
  const groups = groupProjects(
    [
      project("never", { sort_order: 1 }),
      project("old", { sort_order: 2 }),
      project("new", { sort_order: 3 }),
      project("never2", { sort_order: 0 }),
    ],
    {
      old: idle({ lastActiveAt: NOW - DAY }),
      new: idle({ lastActiveAt: NOW - MIN }),
    },
    "recent"
  );
  assert.deepEqual(names(groups), [["new", "old", "never2", "never"]]);
});

test("groupProjects: recent also orders the groups by their first", () => {
  const groups = groupProjects(
    [
      project("a", { sort_order: 1, group_name: "Old" }),
      project("b", { sort_order: 2, group_name: "New" }),
    ],
    { a: idle({ lastActiveAt: NOW - DAY }), b: idle({ lastActiveAt: NOW }) },
    "recent"
  );
  assert.deepEqual(
    groups.map((g) => g.name),
    ["New", "Old"]
  );
});

test("groupProjects: name sort ignores case", () => {
  const groups = groupProjects(
    [
      project("x1", { name: "zeta", sort_order: 1 }),
      project("x2", { name: "Alpha", sort_order: 2 }),
      project("x3", { name: "beta", sort_order: 3 }),
    ],
    {},
    "name"
  );
  assert.deepEqual(names(groups), [["x2", "x3", "x1"]]);
});

test("reorderWithin: a group's drag keeps the others in place", () => {
  // Pinned a, c; group b, d, e: d dragged above b
  assert.deepEqual(reorderWithin(["a", "b", "c", "d", "e"], ["d", "b", "e"]), [
    "a",
    "d",
    "c",
    "b",
    "e",
  ]);
  assert.deepEqual(reorderWithin(["a", "b"], ["b", "a"]), ["b", "a"]);
  assert.deepEqual(reorderWithin(["a", "b"], []), ["a", "b"]);
});
