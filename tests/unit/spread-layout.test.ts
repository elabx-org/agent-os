import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spreadLayout,
  type SpreadInput,
  type SpreadLayout,
} from "../../components/views/spread-layout";

/** The open Duo flat, one session with a folder, in chat */
const OPEN: SpreadInput = {
  duo: true,
  desktop: false,
  pages: true,
  book: false,
  focus: false,
  homeWanted: false,
  pageOpen: false,
  pageSpread: false,
  paneCount: 1,
  hasSession: true,
  hasFolder: true,
  replying: false,
  viewMode: "chat",
  liveOpen: false,
  railByDefault: false,
  changesOpen: false,
  roomForRail: false,
};
const BOOK: SpreadInput = { ...OPEN, book: true };

/** The slots that are on, for compact asserts (the review's own test reads reviewRoom) */
function on(layout: SpreadLayout): string[] {
  return Object.entries(layout)
    .filter(([k, v]) => v && k !== "reviewRoom")
    .map(([k]) => k)
    .sort();
}

test("flat open, chat: the pane spans the pages, Changes has room", () => {
  assert.deepEqual(on(spreadLayout(OPEN)), ["changesRoom", "paneWide"]);
});

test("flat open, Changes asked: pane left, Changes beside it", () => {
  for (const viewMode of ["chat", "terminal"] as const)
    assert.deepEqual(
      on(spreadLayout({ ...OPEN, viewMode, changesOpen: true })),
      ["changesBeside", "changesRoom", "paneLeft"]
    );
});

test("book pose, Changes asked: the same, chat or terminal", () => {
  for (const viewMode of ["chat", "terminal"] as const)
    assert.deepEqual(
      on(spreadLayout({ ...BOOK, viewMode, changesOpen: true })),
      ["changesBeside", "changesRoom", "paneLeft"]
    );
});

test("book pose without Changes keeps its own layout", () => {
  assert.deepEqual(on(spreadLayout(BOOK)), ["changesRoom", "paneWide"]);
  assert.deepEqual(on(spreadLayout({ ...BOOK, viewMode: "terminal" })), [
    "changesRoom",
    "pageGap",
    "paneRight",
  ]);
  // Focus on the terminal: Changes reads on the left page
  assert.deepEqual(
    on(spreadLayout({ ...BOOK, viewMode: "terminal", focus: true })),
    ["changesLeft", "changesRoom", "pageGap"]
  );
});

test("Focus: Changes asked still takes the right page", () => {
  const flat = spreadLayout({ ...OPEN, focus: true, changesOpen: true });
  assert.equal(flat.changesBeside, true);
  assert.equal(flat.paneLeft, true);
  assert.equal(flat.paneWide, false);
  const book = spreadLayout({
    ...BOOK,
    focus: true,
    viewMode: "terminal",
    changesOpen: true,
  });
  assert.equal(book.changesBeside, true);
  assert.equal(book.changesLeft, false, "not Changes on both pages");
  assert.equal(book.pageGap, false);
});

test("Live and Changes share the right page", () => {
  const live = spreadLayout({ ...OPEN, liveOpen: true });
  assert.equal(live.showRail, true);
  assert.equal(live.paneLeft, true);
  const both = spreadLayout({ ...OPEN, liveOpen: true, changesOpen: true });
  assert.equal(both.showRail, true);
  assert.equal(both.changesBeside, false);
  // The iOS app without the column always has the rail; Changes replaces it
  const old = spreadLayout({ ...OPEN, railByDefault: true, changesOpen: true });
  assert.equal(old.showRail, false);
  assert.equal(old.changesBeside, true);
});

test("the home, a page or two panes take the pages: no room for Changes", () => {
  const home = spreadLayout({ ...OPEN, homeWanted: true, changesOpen: true });
  assert.equal(home.homeOpen, true);
  assert.equal(home.changesRoom, false);
  assert.equal(home.changesBeside, false);
  assert.equal(home.paneLeft, false);

  const page = spreadLayout({ ...OPEN, pageOpen: true, changesOpen: true });
  assert.equal(page.changesRoom, false);
  assert.equal(page.changesBeside, false);
  assert.equal(page.paneRight, true);

  const two = spreadLayout({ ...OPEN, paneCount: 2, changesOpen: true });
  assert.equal(two.changesRoom, false);
  assert.equal(two.changesBeside, false);
  assert.equal(two.splitFold, true);
});

test("replying hides Changes without closing it", () => {
  const typing = spreadLayout({ ...OPEN, replying: true, changesOpen: true });
  assert.equal(typing.replyLeft, true);
  assert.equal(typing.changesRoom, true, "kept for after the reply");
  assert.equal(typing.changesBeside, false);
  assert.equal(typing.paneRight, true);
  assert.equal(typing.paneLeft, false);
});

test("the git, files and workers views have no Changes beside", () => {
  for (const viewMode of ["git", "files", "workers"] as const) {
    const l = spreadLayout({ ...OPEN, viewMode, changesOpen: true });
    assert.equal(l.changesRoom, false, viewMode);
    assert.equal(l.changesBeside, false, viewMode);
    assert.equal(l.paneWide, true, viewMode);
  }
});

test("no folder or no session: no Changes", () => {
  assert.equal(
    spreadLayout({ ...OPEN, hasFolder: false, changesOpen: true }).changesRoom,
    false
  );
  assert.equal(
    spreadLayout({ ...OPEN, hasSession: false, changesOpen: true })
      .changesBeside,
    false
  );
});

test("off the pages (tabletop, closed, web, desktop) Changes never shows", () => {
  const web: SpreadInput = {
    ...OPEN,
    duo: false,
    pages: false,
    roomForRail: true,
    changesOpen: true,
  };
  const l = spreadLayout(web);
  assert.equal(l.changesRoom, false);
  assert.equal(l.changesBeside, false);
  assert.equal(l.paneLeft, false);
  assert.equal(l.showRail, true, "the web's rail is unchanged");
  const desk = spreadLayout({ ...web, desktop: true, paneCount: 2 });
  assert.equal(desk.showRail, false);
  // The Duo off its pages (tabletop, closed): no rail, nothing beside
  const tabletop = spreadLayout({ ...web, duo: true });
  assert.deepEqual(on(tabletop), []);
});

test("desktop agents view: its detail panel takes the live rail's place (D-Tree)", () => {
  const DESK: SpreadInput = {
    ...OPEN,
    duo: false,
    desktop: true,
    pages: false,
    roomForRail: true,
  };
  assert.equal(spreadLayout(DESK).showRail, true);
  assert.equal(spreadLayout({ ...DESK, viewMode: "agents" }).showRail, false);
});

test("diff review (M12): beside the chat on the desktop and the open Duo (D-Diff, O-Diff)", () => {
  const DESK: SpreadInput = {
    ...OPEN,
    duo: false,
    desktop: true,
    pages: false,
    roomForRail: true,
  };
  const desk = spreadLayout({ ...DESK, reviewOpen: true });
  assert.equal(desk.reviewBeside, true);
  assert.equal(desk.showRail, false);
  // The 0.1.62 app keeps the rail by default; the review takes its page
  const APP: SpreadInput = { ...OPEN, railByDefault: true };
  assert.equal(spreadLayout(APP).showRail, true);
  assert.equal(spreadLayout(APP).reviewRoom, true);
  const open = spreadLayout({ ...APP, reviewOpen: true });
  assert.deepEqual(on(open), ["changesRoom", "paneLeft", "reviewBeside"]);
  // The home steps aside; typing keeps the review where it is
  const home = spreadLayout({ ...OPEN, homeWanted: true, reviewOpen: true });
  assert.equal(home.homeOpen, false);
  assert.equal(home.reviewBeside, true);
  const typing = spreadLayout({ ...OPEN, replying: true, reviewOpen: true });
  assert.equal(typing.replyLeft, false);
  assert.equal(typing.reviewBeside, true);
  // No room: the terminal, a workspace page, two sessions on the pages, the
  // closed Duo and the phone (the chat draws it over itself)
  for (const no of [
    { ...OPEN, viewMode: "terminal" as const },
    { ...OPEN, pageOpen: true },
    { ...OPEN, paneCount: 2 },
    { ...OPEN, pages: false },
    { ...DESK, desktop: false },
  ]) {
    const l = spreadLayout({ ...no, reviewOpen: true });
    assert.equal(l.reviewBeside, false);
  }
});
