import { useEffect } from "react";
import { proxy, useSnapshot } from "valtio";
import { mobileNavStore } from "@/stores/mobileNav";
import { newSurfaceStore } from "@/stores/newSurface";
import { settingsPageStore } from "@/stores/settingsPage";
import {
  workspacePageStore,
  type WorkspacePageKind,
} from "@/stores/workspacePage";

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
  | "search";

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
}

export function surfaceFor(inputs: SurfaceInputs): Surface {
  // Contract stub: U1.2 implements the precedence
  if (inputs.settingsOpen) return "settings";
  return inputs.homeOpen ? "now" : "session";
}

/** What only app/page.tsx knows: its pane count and whether Find is open */
export const surfaceStore = proxy<{ paneCount: number; searchOpen: boolean }>({
  paneCount: 1,
  searchOpen: false,
});

/** Called once from app/page.tsx with its own state */
export function useSurfaceSource(inputs: {
  paneCount: number;
  searchOpen: boolean;
}): void {
  const { paneCount, searchOpen } = inputs;
  useEffect(() => {
    surfaceStore.paneCount = paneCount;
    surfaceStore.searchOpen = searchOpen;
  }, [paneCount, searchOpen]);
}

export function useSurface(): Surface {
  const { homeOpen, inboxOpen } = useSnapshot(mobileNavStore);
  const { page } = useSnapshot(workspacePageStore);
  const { open: settingsOpen } = useSnapshot(settingsPageStore);
  const { open: newOpen } = useSnapshot(newSurfaceStore);
  const { paneCount, searchOpen } = useSnapshot(surfaceStore);
  return surfaceFor({
    homeOpen,
    page: page?.kind ?? null,
    settingsOpen,
    newOpen,
    inboxOpen,
    searchOpen,
    paneCount,
  });
}
