import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columnFor,
  type ColumnContext,
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
  ["now", "duo-closed", "new* inbox(on)[2a] projects search | settings"],
  [
    "now",
    "duo-open",
    "new* inbox[2a] | terminal git[3n] files beside | search more",
  ],
  ["now", "tabletop", "new* inbox(on)[2a] projects search | settings"],
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
  assert.equal(
    fmt(columnFor("session", "duo-closed", { ...CTX, sheet: "permissions" })),
    "closeSheet | done*"
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
    "new* inbox projects search | settings"
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
      ["Settings", "gearshape", "Settings"],
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
