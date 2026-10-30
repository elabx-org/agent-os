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
