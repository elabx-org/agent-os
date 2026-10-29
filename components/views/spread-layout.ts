/**
 * What SessionSpread shows where: the home, the panes, the live activity
 * rail, Changes and the reply context, from the posture and the stores.
 * Pure, so the matrix of postures and surfaces can be tested.
 */

import type { PaneViewMode } from "@/stores/mobileNav";

export interface SpreadInput {
  /** The Duo lays out as two pages (the app, or Safari open or half open) */
  duo: boolean;
  /** The desktop shell: sidebar, no column */
  desktop: boolean;
  /** Two pages either side of the fold (flat open, or the book pose) */
  pages: boolean;
  /** Half open with a vertical fold */
  book: boolean;
  focus: boolean;
  homeWanted: boolean;
  /** A workspace page stands in for the panes */
  pageOpen: boolean;
  /** That page lays out its own list | detail across both pages */
  pageSpread: boolean;
  paneCount: number;
  hasSession: boolean;
  /** The focused session has a folder (Changes needs one) */
  hasFolder: boolean;
  /** Typing a reply with Claude's last turn to show beside it */
  replying: boolean;
  viewMode: PaneViewMode;
  liveOpen: boolean;
  /** The iOS app without the column: no Live to ask with, so always the rail */
  railByDefault: boolean;
  /** The column's Changes asked for Changes beside the conversation */
  changesOpen: boolean;
  /** The web viewport has room for the rail */
  roomForRail: boolean;
}

export interface SpreadLayout {
  /** The workspace page takes both pages */
  pageWide: boolean;
  /** Two sessions open on the pages */
  twoPages: boolean;
  /** Claude's last turn on the left page, the pane right */
  replyLeft: boolean;
  homeOpen: boolean;
  /** Two panes, one on each side of the fold */
  splitFold: boolean;
  /** Half open, Focus on the terminal: the git view on the left page */
  changesLeft: boolean;
  /**
   * Changes could sit beside the conversation: the column's Changes opens it
   * there (Open-Changes), and changesOpen resets once this is false
   */
  changesRoom: boolean;
  /** Changes on the right page beside the conversation */
  changesBeside: boolean;
  showRail: boolean;
  /** The pane on the left page, the rail or Changes on the right */
  paneLeft: boolean;
  /** The pane on the right page */
  paneRight: boolean;
  /** The pane across the fold */
  paneWide: boolean;
  /** The gutter between a left page and the pane */
  pageGap: boolean;
}

export function spreadLayout(i: SpreadInput): SpreadLayout {
  const conversation = i.viewMode === "terminal" || i.viewMode === "chat";
  const pageWide = i.pages && i.pageOpen && i.pageSpread;
  const twoPages = i.pages && i.paneCount > 1 && !i.pageOpen;
  const replyLeft =
    i.pages && i.hasSession && !i.pageOpen && !twoPages && i.replying;
  const homeOpen = i.homeWanted && !pageWide && !replyLeft;
  const splitFold = twoPages && !homeOpen;
  // Typing a reply only lends the pages to the context for a while, so it
  // hides Changes without closing it
  const changesRoom =
    i.pages &&
    i.hasSession &&
    i.hasFolder &&
    !i.pageOpen &&
    !twoPages &&
    !i.homeWanted &&
    conversation;
  // Live and Changes share the right page; Live asked last wins
  const changesBeside =
    changesRoom && i.changesOpen && !replyLeft && !i.liveOpen;
  const changesLeft =
    i.book &&
    i.focus &&
    !homeOpen &&
    !i.pageOpen &&
    !twoPages &&
    !replyLeft &&
    !changesBeside &&
    i.viewMode === "terminal" &&
    i.hasFolder;
  // On the pages the rail sits beside a conversation, once the column's
  // Live asks for it; Changes, Files and Workers take both pages for their
  // own list | detail split
  const showRail =
    i.hasSession &&
    !i.pageOpen &&
    !i.focus &&
    !splitFold &&
    !replyLeft &&
    !changesBeside &&
    (i.pages
      ? !homeOpen && (i.liveOpen || i.railByDefault) && conversation
      : i.roomForRail && !i.duo && !(i.desktop && i.paneCount > 1));
  const paneLeft = i.pages && (showRail || changesBeside);
  // Half open nothing may sit in the bend: only the chat lays itself out as
  // a book, anything else takes the right page. A workspace page takes it
  // flat too: its centred form would sit across the hinge.
  const paneRight =
    i.pages &&
    !homeOpen &&
    !changesLeft &&
    !paneLeft &&
    !splitFold &&
    (replyLeft || (i.pageOpen ? !pageWide : i.book && i.viewMode !== "chat"));
  // Across the fold: content may cross it, controls move right of it
  const paneWide =
    i.pages &&
    !homeOpen &&
    !changesLeft &&
    !paneLeft &&
    !paneRight &&
    !splitFold;
  const pageGap = i.pages && (homeOpen || changesLeft || paneRight);
  return {
    pageWide,
    twoPages,
    replyLeft,
    homeOpen,
    splitFold,
    changesLeft,
    changesRoom,
    changesBeside,
    showRail,
    paneLeft,
    paneRight,
    paneWide,
    pageGap,
  };
}
