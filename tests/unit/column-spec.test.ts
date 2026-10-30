import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentsMoreItem,
  columnFor,
  hiddenSlots,
  moreItems,
  savedOrder,
  type ColumnContext,
  type ColumnOrder,
  type ColumnItem,
} from "../../lib/column-spec";
import type { LayoutMode } from "../../hooks/useLayoutMode";
import { columnIcon } from "../../components/ControlColumn/icons";
import { Circle } from "lucide-react";
import type { Surface } from "../../stores/surface";

/** "| " a separator before, * prominent, (on) selected, [2a] amber / [3n] neutral badge */
function fmt(items: ColumnItem[]): string {
  return items
    .map(
      (i) =>
        `${i.sep ? "| " : ""}${i.id}${i.prominent ? "*" : ""}${i.selected ? "(on)" : ""}${i.badge ? `[${i.badge}${i.badgeTone === "amber" ? "a" : "n"}]` : ""}`
    )
    .join(" ");
}

const CTX: ColumnContext = {
  viewMode: "chat",
  needsYou: 2,
  changes: 3,
  focus: false,
  keyboardUp: false,
  paneCount: 1,
  canGoBack: false,
  native: true,
};

/** The home covers the pane except where it is a page beside it */
const homeBeside = (mode: LayoutMode) =>
  mode === "duo-open" || mode === "book" || mode === "desktop";

// Every surface in every posture, as the mocks draw them
const TABLE: [Surface, LayoutMode, string][] = [
  ["now", "phone", "now(on) inbox[2a] projects settings | new*"],
  ["now", "duo-closed", "new* inbox(on)[2a] projects search | more"],
  [
    "now",
    "duo-open",
    "new* inbox[2a] | terminal git[3n] files beside | search more",
  ],
  ["now", "tabletop", "new* inbox(on)[2a] projects search | more"],
  [
    "now",
    "book",
    "new* inbox[2a] | terminal git[3n] files beside | search more",
  ],
  [
    "now",
    "desktop",
    "new* inbox[2a] | terminal git[3n] files beside | search more",
  ],
  ["session", "phone", "chat(on) git[3n] files live | inbox[2a] more"],
  ["session", "duo-closed", "back | terminal git[3n] files live | more"],
  ["session", "duo-open", "back | terminal git[3n] files live | more"],
  ["session", "tabletop", "chat(on) git[3n] files live | inbox[2a] more"],
  ["session", "book", "back | terminal git[3n] files live | more"],
  ["session", "desktop", "back | terminal git[3n] files live | more"],
  ["beside", "phone", "chat(on) git[3n] files live | inbox[2a] more"],
  ["beside", "duo-closed", "back | terminal git[3n] files live | more"],
  ["beside", "duo-open", "back | beside(on) swap live | more"],
  ["beside", "tabletop", "chat(on) git[3n] files live | inbox[2a] more"],
  ["beside", "book", "back | beside(on) swap live | more"],
  ["beside", "desktop", "back | beside(on) swap live | more"],
  ["project", "phone", "now inbox[2a] projects(on) settings | new*"],
  ["project", "duo-closed", "back | new* search | projectSettings"],
  ["project", "duo-open", "back | new* search | projectSettings"],
  ["project", "tabletop", "back | new* search | projectSettings"],
  ["project", "book", "back | new* search | projectSettings"],
  ["project", "desktop", "back | new* search | projectSettings"],
  ["projects", "phone", "now inbox[2a] projects(on) settings | new*"],
  ["projects", "duo-closed", "back | newProject* search sort"],
  ["projects", "duo-open", "back | newProject* search sort"],
  ["projects", "tabletop", "back | newProject* search sort"],
  ["projects", "book", "back | newProject* search sort"],
  ["projects", "desktop", "back | newProject* search sort"],
  ["needs", "phone", "now inbox(on)[2a] projects settings | new*"],
  ["needs", "duo-closed", "back | notifSettings clearHistory"],
  ["needs", "duo-open", "back | notifSettings clearHistory"],
  ["needs", "tabletop", "back | notifSettings clearHistory"],
  ["needs", "book", "back | notifSettings clearHistory"],
  ["needs", "desktop", "back | notifSettings clearHistory"],
  ["settings", "phone", "now inbox[2a] projects settings(on) | new*"],
  ["settings", "duo-closed", "closeSettings | server"],
  ["settings", "duo-open", "closeSettings | server"],
  ["settings", "tabletop", "closeSettings | server"],
  ["settings", "book", "closeSettings | server"],
  ["settings", "desktop", "closeSettings | server"],
  ["new", "phone", "now inbox[2a] projects settings | new*"],
  ["new", "duo-closed", "back | start*"],
  ["new", "duo-open", "back | start*"],
  ["new", "tabletop", "back | start*"],
  ["new", "book", "back | start*"],
  ["new", "desktop", "back | start*"],
  ["search", "phone", "now inbox[2a] projects settings | new*"],
  ["search", "duo-closed", "back"],
  ["search", "duo-open", "back"],
  ["search", "tabletop", "back"],
  ["search", "book", "back"],
  ["search", "desktop", "back"],
];

test("columnFor: every surface in every posture", () => {
  for (const [surface, mode, expected] of TABLE) {
    const viewMode =
      surface === "now" && !homeBeside(mode) ? null : CTX.viewMode;
    assert.equal(
      fmt(columnFor(surface, mode, { ...CTX, viewMode })),
      expected,
      `${surface} × ${mode}`
    );
  }
});

test("columnFor: the session shows the other conversation view", () => {
  const terminal = columnFor("session", "duo-closed", {
    ...CTX,
    viewMode: "terminal",
  });
  assert.equal(terminal[1].id, "chat");
  assert.equal(terminal[1].label, "Show chat");
  const changes = columnFor("session", "duo-open", {
    ...CTX,
    viewMode: "git",
  });
  assert.equal(fmt(changes), "back | chat git(on)[3n] files live | more");
});

test("columnFor: the closed git and files views have their own (E-Git, E-Files)", () => {
  const git = columnFor("session", "duo-closed", { ...CTX, viewMode: "git" });
  assert.equal(fmt(git), "back | pull push newPr | more");
  assert.deepEqual(
    git.map((i) => [i.label, i.symbol]),
    [
      ["Back to session", "chevron.left"],
      ["Pull", "arrow.down.to.line"],
      ["Push", "arrow.up.to.line"],
      ["New pull request", "arrow.triangle.pull"],
      ["More", "ellipsis"],
    ]
  );
  const files = columnFor("session", "duo-closed", {
    ...CTX,
    viewMode: "files",
  });
  assert.equal(fmt(files), "back | newFile upload | more");
  assert.equal(files[1].label, "New file");
  // The keyboard up (a commit message, a search) keeps what fits
  assert.equal(
    fmt(
      columnFor("session", "duo-closed", {
        ...CTX,
        viewMode: "git",
        keyboardUp: true,
      })
    ),
    "back | pull push more"
  );
  // Working doesn't swap in Stop here; a sheet still wins
  assert.equal(
    fmt(
      columnFor("session", "duo-closed", {
        ...CTX,
        viewMode: "files",
        working: true,
      })
    ),
    "back | newFile upload | more"
  );
  assert.equal(
    fmt(
      columnFor("session", "duo-closed", {
        ...CTX,
        viewMode: "git",
        liveOpen: true,
      })
    ),
    "closeSheet"
  );
  for (const i of [...git, ...files])
    assert.notEqual(columnIcon(i.icon), Circle, `${i.id}: ${i.icon}`);
});

test("columnFor: Changes is on while its page shows beside the chat (Open-Changes)", () => {
  assert.equal(
    fmt(columnFor("session", "duo-open", { ...CTX, changesOpen: true })),
    "back | terminal git(on)[3n] files live | more"
  );
});

test("columnFor: keyboard up compacts the closed session column (Closed-Terminal)", () => {
  const ctx = { ...CTX, viewMode: "terminal" as const, keyboardUp: true };
  assert.equal(
    fmt(columnFor("session", "duo-closed", ctx)),
    "back | chat git[3n] more"
  );
  // Only the closed Duo's column is that short
  assert.equal(
    fmt(columnFor("session", "duo-open", ctx)),
    "back | chat git[3n] files live | more"
  );
});

test("columnFor: working, the closed column ends with Stop (N-Queue)", () => {
  const ctx = { ...CTX, working: true };
  const items = columnFor("session", "duo-closed", ctx);
  assert.equal(fmt(items), "back | terminal git[3n] live | stop");
  assert.equal(items.at(-1)?.danger, true);
  assert.equal(items.at(-1)?.symbol, "stop.fill");
  // Elsewhere the column keeps More
  assert.equal(
    fmt(columnFor("session", "duo-open", ctx)),
    "back | terminal git[3n] files live | more"
  );
});

test("columnFor: a sheet over the closed session (E-Live, N-Undo)", () => {
  assert.equal(
    fmt(
      columnFor("session", "duo-closed", {
        ...CTX,
        liveOpen: true,
        working: true,
      })
    ),
    "closeSheet | stop"
  );
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, liveOpen: true })),
    "closeSheet"
  );
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, sheet: "undo" })),
    "closeSheet | git[3n]"
  );
  // N-Switch: the close alone
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, sheet: "switch" })),
    "closeSheet"
  );
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, sheet: "permissions" })),
    "closeSheet | done*"
  );
  // N-Worktree: close | Move session, over a session or a project's row
  const move = { ...CTX, sheet: "move" as const };
  assert.equal(
    fmt(columnFor("session", "duo-closed", move)),
    "closeSheet | done*"
  );
  assert.equal(
    fmt(columnFor("project", "duo-closed", move)),
    "closeSheet | done*"
  );
  assert.equal(
    columnFor("session", "duo-closed", move)[1].label,
    "Move session"
  );
  // On the open Duo too (the sheet stops at the web column)
  assert.equal(
    fmt(columnFor("session", "duo-open", move)),
    "closeSheet | done*"
  );
  assert.equal(fmt(columnFor("session", "book", move)), "closeSheet | done*");
  // Waiting for the turn: Cancel move, not prominent; nothing to do: × alone
  const waiting = columnFor("session", "duo-closed", {
    ...move,
    sheetAction: "cancel",
  });
  assert.equal(fmt(waiting), "closeSheet | done");
  assert.equal(waiting[1].label, "Cancel move");
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...move, sheetAction: "none" })),
    "closeSheet"
  );
  // The open Duo shows Live activity as its rail: no sheet column
  assert.equal(
    fmt(columnFor("session", "duo-open", { ...CTX, liveOpen: true })),
    "back | terminal git[3n] files live(on) | more"
  );
});

test("columnFor: the bar selects the view showing (Fold-Chat, Fold-Terminal)", () => {
  assert.equal(
    fmt(
      columnFor("session", "tabletop", {
        ...CTX,
        viewMode: "terminal",
        needsYou: 0,
      })
    ),
    "terminal(on) git[3n] files live | more"
  );
  assert.equal(
    fmt(columnFor("session", "tabletop", { ...CTX, viewMode: "files" })),
    "chat git[3n] files(on) live | inbox[2a] more"
  );
});

test("columnFor: Focus hides the counts", () => {
  const ctx = { ...CTX, focus: true };
  assert.equal(
    fmt(columnFor("now", "duo-closed", { ...ctx, viewMode: null })),
    "new* inbox projects search | more"
  );
  assert.equal(
    fmt(columnFor("session", "tabletop", ctx)),
    "chat(on) git files live | more"
  );
});

test("columnFor: Settings", () => {
  // A section drilled into on the closed Duo (E-Display)
  const detail = columnFor("settings", "duo-closed", {
    ...CTX,
    canGoBack: true,
  });
  assert.equal(fmt(detail), "back");
  assert.equal(detail[0].label, "Back to Settings");
  // list | detail on the open Duo: nothing to go back to
  assert.equal(
    fmt(columnFor("settings", "duo-open", { ...CTX, canGoBack: true })),
    "closeSettings | server"
  );
  // Server is the iOS app's screen
  assert.equal(
    fmt(columnFor("settings", "duo-closed", { ...CTX, native: false })),
    "closeSettings"
  );
});

test("columnFor: labels, symbols and icons as the mocks", () => {
  const now = columnFor("now", "duo-closed", { ...CTX, viewMode: null });
  assert.deepEqual(
    now.map((i) => [i.label, i.symbol, i.icon]),
    [
      ["New session", "plus", "Plus"],
      ["Needs you", "tray", "Inbox"],
      ["Projects", "folder", "Folder"],
      ["Find", "magnifyingglass", "Search"],
      ["More", "ellipsis", "Ellipsis"],
    ]
  );
  const tabs = columnFor("now", "phone", { ...CTX, viewMode: null });
  assert.deepEqual(
    tabs.map((i) => [i.label, i.icon]),
    [
      ["Now", "Activity"],
      ["Needs you", "Inbox"],
      ["Projects", "Folder"],
      ["Settings", "Settings"],
      ["New session", "Plus"],
    ]
  );
  assert.deepEqual(
    columnFor("projects", "duo-closed", CTX).map((i) => i.label),
    ["Back to Now", "New project", "Find a project", "Edit order and groups"]
  );
  assert.deepEqual(
    columnFor("project", "duo-closed", CTX).map((i) => i.label),
    ["Back", "New session", "Find in project", "Project actions"]
  );
  assert.deepEqual(
    columnFor("new", "duo-closed", CTX).map((i) => [i.label, i.symbol]),
    [
      ["Cancel", "xmark"],
      ["Start", "checkmark"],
    ]
  );
  assert.equal(columnFor("beside", "duo-open", CTX)[1].label, "Side by side");
});

test("columnFor: Live is on while the activity shows", () => {
  const items = columnFor("beside", "duo-open", { ...CTX, liveOpen: true });
  assert.equal(fmt(items), "back | beside(on) swap live(on) | more");
});

test("columnFor: items carry only the keys that are set", () => {
  for (const [surface, mode] of TABLE)
    for (const i of columnFor(surface, mode, CTX))
      for (const [key, value] of Object.entries(i))
        assert.ok(
          value !== undefined && value !== false && value !== 0,
          `${surface} × ${mode}: ${i.id}.${key}`
        );
});

test("columnFor: every icon has a component on the web", () => {
  for (const [surface, mode] of TABLE)
    for (const i of columnFor(surface, mode, CTX))
      assert.notEqual(columnIcon(i.icon), Circle, `${i.id}: ${i.icon}`);
});

// Settings → Control column: the person's own order between the pinned ends
const ORDER: ColumnOrder = {
  session: ["projects", "inbox", "live", "view", "git"],
  beside: ["swap"],
  now: ["inbox", "new"],
};

const ARRANGED: [Surface, LayoutMode, Partial<ColumnContext>, string][] = [
  [
    "session",
    "duo-closed",
    {},
    "back | projects inbox[2a] live terminal git[3n] | more",
  ],
  [
    "session",
    "duo-closed",
    { keyboardUp: true },
    "back | projects inbox[2a] more",
  ],
  [
    "session",
    "duo-open",
    {},
    "back | projects inbox[2a] live terminal git[3n] | more",
  ],
  ["session", "phone", {}, "projects inbox[2a] live chat(on) git[3n] | more"],
  ["beside", "duo-open", {}, "back | swap | more"],
  ["now", "duo-closed", {}, "inbox(on)[2a] new* | more"],
];

for (const [surface, mode, extra, want] of ARRANGED)
  test(`arranged ${surface} on ${mode} ${JSON.stringify(extra)}`, () => {
    assert.equal(
      fmt(columnFor(surface, mode, { ...CTX, ...extra, order: ORDER })),
      want
    );
  });

test("an arranged column hands what it leaves out to More", () => {
  assert.deepEqual(
    moreItems("session", ORDER).map((i) => i.id),
    ["files", "new", "search", "beside"]
  );
  assert.deepEqual(hiddenSlots("now", {}), []);
});

test("a saved order drops unknown and repeated slots", () => {
  assert.deepEqual(
    savedOrder("session", {
      session: ["git", "bogus", "git"],
    } as unknown as ColumnOrder),
    ["git"]
  );
  assert.equal(savedOrder("session", {}), null);
});

test("no saved order keeps the default column", () => {
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, order: {} })),
    fmt(columnFor("session", "duo-closed", CTX))
  );
});

test("columnFor: the closed agents view (N-Tree)", () => {
  const ctx = {
    ...CTX,
    viewMode: "agents" as const,
    agents: 7,
    showFinished: true,
  };
  const items = columnFor("session", "duo-closed", ctx);
  assert.equal(fmt(items), "back | showFinished(on) collapseAll");
  assert.deepEqual(
    items.map((i) => [i.label, i.icon]),
    [
      ["Back to live activity", "ChevronLeft"],
      ["Show finished agents", "Eye"],
      ["Collapse all", "ChevronsDownUp"],
    ]
  );
  // While it works, Interrupt stops the session (not its workers), red
  const working = columnFor("session", "duo-closed", { ...ctx, working: true });
  assert.equal(fmt(working), "back | showFinished(on) collapseAll | stop");
  assert.equal(working.at(-1)?.label, "Interrupt");
  assert.equal(working.at(-1)?.danger, true);
  // Finished hidden; everything folded: Expand all
  const folded = columnFor("session", "duo-closed", {
    ...ctx,
    showFinished: false,
    allCollapsed: true,
  });
  assert.equal(fmt(folded), "back | showFinished collapseAll");
  assert.deepEqual(
    [folded[2].label, folded[2].icon],
    ["Expand all", "ChevronsUpDown"]
  );
  // An agent's detail over the tree: back to it
  const detail = columnFor("session", "duo-closed", {
    ...ctx,
    agentDetail: true,
  });
  assert.equal(fmt(detail), "back");
  assert.equal(detail[0].label, "Back to agents");
  // The Live activity sheet over it keeps its own column
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...ctx, liveOpen: true })),
    "closeSheet"
  );
});

test("columnFor: Agents beside Files on the open Duo (O-Tree)", () => {
  const open = columnFor("session", "duo-open", {
    ...CTX,
    viewMode: "agents",
    agents: 7,
  });
  assert.equal(fmt(open), "back | chat git[3n] files agents(on) live | more");
  assert.equal(open[0].label, "Back to session");
  assert.deepEqual(
    [open[4].label, open[4].symbol, open[4].icon],
    ["Agents", "point.3.connected.trianglepath.dotted", "Workflow"]
  );
  // With agents, from the chat; with none, no item
  assert.equal(
    fmt(columnFor("session", "duo-open", { ...CTX, agents: 2 })),
    "back | terminal git[3n] files agents live | more"
  );
  assert.equal(
    fmt(columnFor("session", "duo-open", { ...CTX, agents: 0 })),
    "back | terminal git[3n] files live | more"
  );
  // The closed chat column stays as Closed-Chat: Agents is in Live activity
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, agents: 2 })),
    "back | terminal git[3n] files live | more"
  );
});

test("columnFor: the tabletop and phone bars add Agents while there are any", () => {
  assert.equal(
    fmt(columnFor("session", "tabletop", { ...CTX, agents: 3 })),
    "chat(on) git[3n] files agents live | inbox[2a] more"
  );
  assert.equal(
    fmt(
      columnFor("session", "phone", {
        ...CTX,
        viewMode: "agents",
        agents: 3,
      })
    ),
    "chat git[3n] files agents(on) live | inbox[2a] more"
  );
});

test("columnFor: the agents items have web icons", () => {
  const items = [
    ...columnFor("session", "duo-closed", {
      ...CTX,
      viewMode: "agents",
      working: true,
    }),
    ...columnFor("session", "duo-closed", {
      ...CTX,
      viewMode: "agents",
      allCollapsed: true,
    }),
    ...columnFor("session", "duo-open", { ...CTX, agents: 1 }),
  ];
  for (const i of items)
    assert.notEqual(columnIcon(i.icon), Circle, `${i.id}: ${i.icon}`);
});

test("columnFor: Scripts sheet and project settings (N-Scripts, N-Config)", () => {
  const scripts = { ...CTX, sheet: "scripts" as const };
  assert.equal(
    fmt(columnFor("session", "duo-closed", scripts)),
    "closeSheet | projectSettings"
  );
  assert.equal(
    fmt(columnFor("project", "duo-closed", scripts)),
    "closeSheet | projectSettings"
  );
  const gear = columnFor("session", "duo-closed", scripts)[1];
  assert.equal(gear.icon, "Settings");
  assert.equal(gear.symbol, "gearshape");
  // The open Duo and desktop show it as a dialog: the column stays
  assert.equal(
    fmt(columnFor("project", "desktop", scripts)),
    "back | new* search | projectSettings"
  );
  for (const mode of ["duo-closed", "duo-open", "desktop"] as LayoutMode[]) {
    const items = columnFor("project", mode, { ...CTX, projectSettings: true });
    assert.equal(fmt(items), "back | scripts viewConfig");
    for (const i of items)
      assert.notEqual(columnIcon(i.icon), Circle, `${i.id}: ${i.icon}`);
  }
});

test("More offers New and Find a session's default column leaves out", () => {
  assert.deepEqual(
    moreItems("session", {}).map((i) => i.id),
    ["inbox", "new", "search", "beside", "projects"]
  );
});

test("the web's Now keeps Settings last; the app's ends in More", () => {
  const web = columnFor("now", "desktop", {
    ...CTX,
    viewMode: null,
    native: false,
  });
  assert.equal(web.at(-1)?.id, "settings");
});

test("a session behind Now: back to it leads, closed and on tabletop", () => {
  for (const mode of ["duo-closed", "tabletop"] as LayoutMode[])
    assert.equal(
      fmt(columnFor("now", mode, { ...CTX, viewMode: null, behind: true })),
      `resume | new* inbox${mode === "duo-closed" || mode === "tabletop" ? "(on)" : ""}[2a] projects search | more`
    );
  assert.equal(
    columnFor("now", "duo-open", { ...CTX, viewMode: null, behind: true })[0]
      ?.id,
    "new"
  );
});

test("More offers a session's agents while the column leaves them out", () => {
  assert.equal(agentsMoreItem(0, 0, "terminal"), null);
  assert.equal(agentsMoreItem(3, 1, "agents"), null);
  const it = agentsMoreItem(323, 2, "chat");
  assert.equal(it?.id, "agents");
  assert.equal(it?.label, "Agents (2)");
  assert.equal(agentsMoreItem(322, 0, "chat")?.label, "Agents");
});
