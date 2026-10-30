import { useEffect } from "react";
import { proxy, useSnapshot } from "valtio";
import { mobileNavStore } from "@/stores/mobileNav";
import { newSurfaceStore } from "@/stores/newSurface";
import { settingsPageStore } from "@/stores/settingsPage";
import {
  workspacePageStore,
  type WorkspacePageKind,
} from "@/stores/workspacePage";
import { layoutStore, type LayoutMode } from "@/hooks/useLayoutMode";

/** What fills the screen, for the column spec and the iOS app */
export type Surface =
  | "now"
  | "session"
  | "beside"
  | "project"
  | "projects"
  | "needs"
  | "settings"
  | "new"
  | "search"
  | "running";

/** What the surface is derived from */
export interface SurfaceInputs {
  homeOpen: boolean;
  /** The workspace page's kind (M1b adds `projects`) */
  page: WorkspacePageKind | "projects" | null;
  settingsOpen: boolean;
  newOpen: boolean;
  inboxOpen: boolean;
  searchOpen: boolean;
  paneCount: number;
  /** Two panes only make Beside where they sit side by side */
  mode?: LayoutMode;
}

/** Postures where two panes sit side by side */
const SIDE_BY_SIDE: LayoutMode[] = ["duo-open", "book", "desktop"];

/**
 * The topmost layer wins: Settings, Find, New, a project, Running,
 * Projects, Needs you, the home, then the panes
 */
export function surfaceFor(inputs: SurfaceInputs): Surface {
  const { page } = inputs;
  if (inputs.settingsOpen) return "settings";
  if (inputs.searchOpen) return "search";
  if (inputs.newOpen || page === "new") return "new";
  if (page === "project" || page === "projectSettings") return "project";
  if (page === "running") return "running";
  if (page === "projects") return "projects";
  if (page === "inbox" || inputs.inboxOpen) return "needs";
  if (inputs.homeOpen && !page) return "now";
  if (
    inputs.paneCount >= 2 &&
    (!inputs.mode || SIDE_BY_SIDE.includes(inputs.mode))
  )
    return "beside";
  return "session";
}

/** What only the views and app/page.tsx know */
export const surfaceStore = proxy<{
  paneCount: number;
  searchOpen: boolean;
  /** The home (Now) is up: the phone's home layer, the Duo's left page or
      the web's sidebar (MobileView / SessionSpread) */
  home: boolean;
  /** The focused pane holds a session: Now can go back to it */
  behind: boolean;
}>({
  paneCount: 1,
  searchOpen: false,
  home: false,
  behind: false,
});

/**
 * The views say whether the home is up. Closed, it comes back as Now: only
 * the phone's tab bar keeps Projects as a tab of its own
 */
export function setHome(open: boolean): void {
  // Only when it closes: a view's cleanup before the home opens says false
  // too, and Projects picked from a session has just set its tab
  if (!open && surfaceStore.home && layoutStore.mode !== "phone")
    mobileNavStore.homeTab = "now";
  surfaceStore.home = open;
}

/**
 * The view showing the home is gone: a fold or a turn swaps it for the
 * other, which says again whether the home is up. Projects stays picked
 */
export function dropHome(): void {
  surfaceStore.home = false;
}

/**
 * On the open Duo's two pages, the one used last: Now on the left or the
 * session (and what it has open) on the right. Folding to one page shows it
 */
let pageUsed: "home" | "session" = "home";

export function notePageUsed(page: "home" | "session"): void {
  pageUsed = page;
}

export function lastPageUsed(): "home" | "session" {
  return pageUsed;
}

/** What a layout switch (a fold, an unfold or a turn) decides from */
export interface SwitchInputs {
  /** The home is Now (a phone, the app), not the web's sidebar */
  narrow: boolean;
  /** It was before the switch */
  wasNarrow: boolean;
  /** One page now: the phone layout (the closed Duo, tabletop) */
  onePage: boolean;
  /** A session is behind the home */
  onSession: boolean;
  sessionId: string | null;
  /** Now (or the sidebar) is up */
  home: boolean;
  focus: boolean;
  /** What the phone showed before it turned to the wide layout */
  before: { home: boolean; sessionId: string | null } | null;
  /** A workspace page takes the right page (not one across both) */
  pageBeside: boolean;
  /** Now was opened by the unfold only to sit beside that page */
  homeForPage: boolean;
  lastPage: "home" | "session";
}

/**
 * The home after a switch: what showed stays (Now stays Now, a session its
 * session), the web's sidebar is its own thing, an unfold fills the left
 * page beside a page with Now, and a fold to one page shows the page used
 */
export function homeAfterSwitch(i: SwitchInputs): {
  home: boolean;
  homeForPage: boolean;
} {
  // To the web's wide layout: its sidebar, as at start
  if (!i.narrow) return { home: !i.focus, homeForPage: false };
  if (!i.onSession) return { home: true, homeForPage: false };
  // Back from it: Now if the phone showed it on this session before
  if (!i.wasNarrow)
    return {
      home: !!i.before?.home && i.before.sessionId === i.sessionId,
      homeForPage: false,
    };
  if (!i.onePage) {
    // Unfolded: a page on the right, Now on the left
    if (i.pageBeside && !i.home) return { home: true, homeForPage: true };
    return { home: i.home, homeForPage: false };
  }
  // Folded to one page: the session if it was used last, or if Now only
  // came to sit beside a page that is still open
  const session = (i.homeForPage && i.pageBeside) || i.lastPage === "session";
  return { home: i.home && !session, homeForPage: false };
}

/** Called once from app/page.tsx with its own state */
export function useSurfaceSource(inputs: {
  paneCount: number;
  searchOpen: boolean;
  behind: boolean;
}): void {
  const { paneCount, searchOpen, behind } = inputs;
  useEffect(() => {
    surfaceStore.paneCount = paneCount;
    surfaceStore.searchOpen = searchOpen;
    surfaceStore.behind = behind;
  }, [paneCount, searchOpen, behind]);
}

interface SurfaceState {
  home: boolean;
  homeTab: "now" | "projects";
  inboxOpen: boolean;
  page: WorkspacePageKind | null;
  settingsOpen: boolean;
  newOpen: boolean;
  searchOpen: boolean;
  paneCount: number;
  mode: LayoutMode;
}

function fromState(s: SurfaceState): Surface {
  return surfaceFor({
    homeOpen: s.home,
    // Now's Projects half stands in for the Projects page until M1b
    page: s.page ?? (s.home && s.homeTab === "projects" ? "projects" : null),
    settingsOpen: s.settingsOpen,
    newOpen: s.newOpen,
    inboxOpen: s.inboxOpen,
    searchOpen: s.searchOpen,
    paneCount: s.paneCount,
    mode: s.mode,
  });
}

/**
 * The surface now, outside React (the iOS bridge); with a layer left out,
 * the one under it (what Back shows)
 */
export function currentSurface(without: Partial<SurfaceState> = {}): Surface {
  return fromState({
    home: surfaceStore.home,
    homeTab: mobileNavStore.homeTab,
    inboxOpen: mobileNavStore.inboxOpen,
    page: workspacePageStore.page?.kind ?? null,
    settingsOpen: settingsPageStore.open,
    newOpen: newSurfaceStore.open,
    searchOpen: surfaceStore.searchOpen,
    paneCount: surfaceStore.paneCount,
    mode: layoutStore.mode,
    ...without,
  });
}

export function useSurface(): Surface {
  const { homeTab, inboxOpen } = useSnapshot(mobileNavStore);
  const { page } = useSnapshot(workspacePageStore);
  const { open: settingsOpen } = useSnapshot(settingsPageStore);
  const { open: newOpen } = useSnapshot(newSurfaceStore);
  const { paneCount, searchOpen, home } = useSnapshot(surfaceStore);
  const { mode } = useSnapshot(layoutStore);
  return fromState({
    home,
    homeTab,
    inboxOpen,
    page: page?.kind ?? null,
    settingsOpen,
    newOpen,
    searchOpen,
    paneCount,
    mode,
  });
}
