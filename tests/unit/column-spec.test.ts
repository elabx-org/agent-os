import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentsMoreItem,
  columnFor,
  hiddenSlots,
  moreExtras,
  moreItems,
  phoneBar,
  savedOrder,
  type MoreSources,
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
  ["now", "phone", "now(on) inbox[2a] projects search settings | new*"],
  ["now", "duo-closed", "new* inbox[2a] projects search | more"],
  // No session behind it: a bare shell on the right gets no session items
  ["now", "duo-open", "new* inbox[2a] projects search | more"],
  ["now", "tabletop", "new* inbox[2a] projects search | more"],
  ["now", "book", "new* inbox[2a] projects search | more"],
  ["now", "desktop", "new* inbox[2a] projects search | more"],
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
  ["project", "phone", "now inbox[2a] projects(on) search settings | new*"],
  ["project", "duo-closed", "back | new* search | projectSettings more"],
  ["project", "duo-open", "back | new* search | projectSettings more"],
  ["project", "tabletop", "back | new* search | projectSettings more"],
  ["project", "book", "back | new* search | projectSettings more"],
  ["project", "desktop", "back | new* search | projectSettings more"],
  ["projects", "phone", "now inbox[2a] projects(on) search settings | new*"],
  ["projects", "duo-closed", "back | newProject* search sort | more"],
  ["projects", "duo-open", "back | newProject* search sort | more"],
  ["projects", "tabletop", "back | newProject* search sort | more"],
  ["projects", "book", "back | newProject* search sort | more"],
  ["projects", "desktop", "back | newProject* search sort | more"],
  ["needs", "phone", "now inbox(on)[2a] projects search settings | new*"],
  ["needs", "duo-closed", "back | notifSettings clearHistory | more"],
  ["needs", "duo-open", "back | notifSettings clearHistory | more"],
  ["needs", "tabletop", "back | notifSettings clearHistory | more"],
  ["needs", "book", "back | notifSettings clearHistory | more"],
  ["needs", "desktop", "back | notifSettings clearHistory | more"],
  ["settings", "phone", "now inbox[2a] projects search settings(on) | new*"],
  ["settings", "duo-closed", "closeSettings | server"],
  ["settings", "duo-open", "closeSettings | server"],
  ["settings", "tabletop", "closeSettings | server"],
  ["settings", "book", "closeSettings | server"],
  ["settings", "desktop", "closeSettings | server"],
  ["new", "phone", "now inbox[2a] projects search settings | new*"],
  ["new", "duo-closed", "back | start* | more"],
  ["new", "duo-open", "back | start* | more"],
  ["new", "tabletop", "back | start* | more"],
  ["new", "book", "back | start* | more"],
  ["new", "desktop", "back | start* | more"],
  ["search", "phone", "now inbox[2a] projects search(on) settings | new*"],
  ["search", "duo-closed", "back | more"],
  ["search", "duo-open", "back | more"],
  ["search", "tabletop", "back | more"],
  ["search", "book", "back | more"],
  ["search", "desktop", "back | more"],
  ["running", "phone", "now inbox[2a] projects search settings | new*"],
  ["running", "duo-closed", "back | more"],
  ["running", "duo-open", "back | more"],
  ["running", "tabletop", "back | more"],
  ["running", "book", "back | more"],
  ["running", "desktop", "back | more"],
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

test("columnFor: working, Stop stands before More on the closed Duo (N-Queue)", () => {
  const ctx = { ...CTX, working: true };
  const items = columnFor("session", "duo-closed", ctx);
  assert.equal(fmt(items), "back | terminal git[3n] live | stop more");
  assert.equal(items.at(-2)?.danger, true);
  assert.equal(items.at(-2)?.symbol, "stop.fill");
  // An arranged column keeps More too
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...ctx, order: ORDER })),
    "back | projects inbox[2a] live terminal git[3n] | stop more"
  );
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
      ["Find", "Search"],
      ["Settings", "Settings"],
      ["New session", "Plus"],
    ]
  );
  assert.deepEqual(
    columnFor("projects", "duo-closed", CTX).map((i) => i.label),
    [
      "Back to Now",
      "New project",
      "Find a project",
      "Edit order and groups",
      "More",
    ]
  );
  // Project actions has its own symbol, More the ⋯
  assert.deepEqual(
    columnFor("project", "duo-closed", CTX).map((i) => [i.label, i.symbol]),
    [
      ["Back", "chevron.left"],
      ["New session", "plus"],
      ["Find in project", "magnifyingglass"],
      ["Project actions", "folder.badge.gearshape"],
      ["More", "ellipsis"],
    ]
  );
  assert.deepEqual(
    columnFor("new", "duo-closed", CTX).map((i) => [i.label, i.symbol]),
    [
      ["Cancel", "xmark"],
      ["Start", "checkmark"],
      ["More", "ellipsis"],
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
    // The keyboard up keeps the view switch and Changes, whatever the order
    { keyboardUp: true },
    "back | terminal git[3n] more",
  ],
  [
    "session",
    "duo-open",
    {},
    "back | projects inbox[2a] live terminal git[3n] | more",
  ],
  ["session", "phone", {}, "projects inbox[2a] live chat(on) git[3n] | more"],
  ["beside", "duo-open", {}, "back | swap | more"],
  ["now", "duo-closed", {}, "inbox[2a] new* | more"],
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
    "back | new* search | projectSettings more"
  );
  for (const mode of ["duo-closed", "duo-open", "desktop"] as LayoutMode[]) {
    const items = columnFor("project", mode, { ...CTX, projectSettings: true });
    assert.equal(fmt(items), "back | scripts viewConfig | more");
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
      "resume | new* inbox[2a] projects search | more"
    );
  assert.equal(
    columnFor("now", "duo-open", { ...CTX, viewMode: null, behind: true })[0]
      ?.id,
    "new"
  );
});

test("Open-Now beside a session keeps Projects; Needs you is never on (24, 10)", () => {
  const ctx = { ...CTX, behind: true };
  for (const mode of ["duo-open", "book", "desktop"] as LayoutMode[])
    assert.equal(
      fmt(columnFor("now", mode, ctx)),
      "resume | new* inbox[2a] projects | terminal git[3n] files beside | search more"
    );
  for (const mode of ["duo-closed", "tabletop", "duo-open"] as LayoutMode[])
    for (const it of columnFor("now", mode, { ...CTX, viewMode: null }))
      assert.ok(!it.selected, `${mode}: ${it.id}`);
});

test("More never offers the view showing (23)", () => {
  const order: ColumnOrder = { session: ["view", "git", "live"] };
  assert.deepEqual(
    moreItems("session", order, "chat").map((i) => i.id),
    ["files", "inbox", "new", "search", "beside", "projects"]
  );
  assert.deepEqual(
    moreItems("session", order, "files").map((i) => i.id),
    ["inbox", "new", "search", "beside", "projects"]
  );
});

test("moreExtras: the other view, the session's actions, Running (21, DPD-13)", () => {
  const session = { scripts: true, settle: true, copyId: true };
  const ids = (src: Partial<MoreSources>) =>
    moreExtras({
      surface: "session",
      viewMode: "chat",
      shown: [],
      running: true,
      session,
      ...src,
    }).map((i) => i.id);
  assert.deepEqual(ids({}), ["scripts", "settle", "copyId", "running"]);
  // Files with the bar's Chat: Terminal too
  assert.deepEqual(ids({ viewMode: "files", shown: ["chat", "files"] }), [
    "terminal",
    "scripts",
    "settle",
    "copyId",
    "running",
  ]);
  // The closed Files column shows neither
  assert.deepEqual(ids({ viewMode: "files", shown: ["back"] }).slice(0, 2), [
    "chat",
    "terminal",
  ]);
  assert.deepEqual(
    ids({ session: { scripts: false, settle: false, copyId: true } }),
    ["copyId", "running"]
  );
  // Off a session only Running, and never on Running itself
  assert.deepEqual(ids({ surface: "projects", viewMode: null }), ["running"]);
  assert.deepEqual(ids({ surface: "running", viewMode: null }), []);
  assert.deepEqual(ids({ running: false, surface: "now" }), []);
});

test("More offers a session's agents while the column leaves them out", () => {
  assert.equal(agentsMoreItem(0, 0, "terminal"), null);
  assert.equal(agentsMoreItem(3, 1, "agents"), null);
  const it = agentsMoreItem(323, 2, "chat");
  assert.equal(it?.id, "agents");
  assert.equal(it?.label, "Agents (2)");
  assert.equal(agentsMoreItem(322, 0, "chat")?.label, "Agents");
});

test("columnFor: back is named for where it goes", () => {
  const label = (surface: Surface, mode: LayoutMode, ctx: ColumnContext) =>
    columnFor(surface, mode, ctx).find((i) => i.id === "back")?.label;
  // Without a target, the defaults
  assert.equal(label("search", "duo-closed", CTX), "Back to Now");
  assert.equal(
    label("session", "duo-closed", { ...CTX, viewMode: "git" }),
    "Back to session"
  );
  // With one, every column that leads with back says it
  const ctx = { ...CTX, backLabel: "Back to agent-os" };
  for (const [surface, mode] of [
    ["session", "duo-closed"],
    ["session", "duo-open"],
    ["beside", "book"],
    ["search", "duo-closed"],
    ["needs", "duo-closed"],
    ["projects", "duo-closed"],
    ["project", "duo-open"],
  ] as [Surface, LayoutMode][])
    assert.equal(label(surface, mode, ctx), "Back to agent-os", surface);
  assert.equal(
    label("session", "duo-closed", {
      ...ctx,
      viewMode: "git",
      backLabel: "Back to history",
    }),
    "Back to history"
  );
  // The keyboard up keeps it short; New is Cancel
  assert.equal(
    label("session", "duo-closed", { ...ctx, keyboardUp: true }),
    "Back"
  );
  assert.equal(label("new", "duo-closed", ctx), "Cancel");
});

test("columnFor: Settings from Needs you goes back to it", () => {
  const ctx = {
    ...CTX,
    settingsFrom: "needs" as const,
    backLabel: "Back to Needs you",
  };
  const open = columnFor("settings", "duo-open", ctx);
  assert.equal(fmt(open), "back | server");
  assert.equal(open[0].label, "Back to Needs you");
  const closed = columnFor("settings", "duo-closed", {
    ...ctx,
    canGoBack: true,
  });
  assert.equal(fmt(closed), "back");
  assert.equal(closed[0].label, "Back to Needs you");
});

test("keyboard up on the closed Duo: More has all the column leaves out", () => {
  // The column is back | view git | more whatever the saved order
  const order: ColumnOrder = {
    session: ["projects", "inbox", "live", "view", "git"],
  };
  const column = columnFor("session", "duo-closed", {
    ...CTX,
    order,
    keyboardUp: true,
  }).map((i) => i.id);
  const more = moreItems("session", order, "chat", true).map((i) => i.id);
  assert.deepEqual(more, [
    "files",
    "live",
    "inbox",
    "new",
    "search",
    "beside",
    "projects",
  ]);
  for (const id of more) assert.ok(!column.includes(id), id);
});

test("an arranged column shows Files or Changes, picked, while it's up (15)", () => {
  const order: ColumnOrder = { session: ["projects", "inbox", "live", "view"] };
  assert.equal(
    fmt(columnFor("session", "duo-open", { ...CTX, viewMode: "files", order })),
    "back | projects inbox[2a] live chat files(on) | more"
  );
  assert.equal(
    fmt(columnFor("session", "duo-open", { ...CTX, viewMode: "git", order })),
    "back | projects inbox[2a] live chat git(on)[3n] | more"
  );
  // In the order already: where it was put
  assert.equal(
    fmt(
      columnFor("session", "duo-open", {
        ...CTX,
        viewMode: "files",
        order: { session: ["files", "view"] },
      })
    ),
    "back | files(on) chat | more"
  );
});

test("one page has no Open beside, in More or an arranged column (DPDV-N1)", () => {
  assert.deepEqual(
    moreItems("session", {}, "chat", false, false).map((i) => i.id),
    ["inbox", "new", "search", "projects"]
  );
  assert.ok(
    moreItems("session", {}, "chat").some((i) => i.id === "beside"),
    "the open Duo keeps it"
  );
  const order: ColumnOrder = { session: ["view", "beside", "git"] };
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, order })),
    "back | terminal git[3n] | more"
  );
  assert.equal(
    fmt(columnFor("session", "tabletop", { ...CTX, order })),
    "chat(on) git[3n] | inbox[2a] more"
  );
  assert.equal(
    fmt(columnFor("session", "duo-open", { ...CTX, order })),
    "back | terminal beside git[3n] | more"
  );
});

test("a phone on its side has no bar under a session", () => {
  assert.equal(phoneBar("session", false), "session");
  assert.equal(phoneBar("beside", false), "session");
  assert.equal(phoneBar("session", true), null);
  assert.equal(phoneBar("beside", true), null);
  // The home and its pages keep the tab bar: Find, New and the rest
  for (const surface of ["now", "search", "projects", "settings"] as const) {
    assert.equal(phoneBar(surface, false), "tabs");
    assert.equal(phoneBar(surface, true), "tabs");
  }
});
