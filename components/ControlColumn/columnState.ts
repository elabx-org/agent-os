"use client";

import { useSnapshot } from "valtio";
import {
  WIDE,
  columnFor,
  type ColumnContext,
  type ColumnItem,
} from "@/lib/column-spec";
import type { NativeColumnItem } from "@/lib/native-bridge";
import { layoutStore, type LayoutMode } from "@/hooks/useLayoutMode";
import { mobileNavStore } from "@/stores/mobileNav";
import { newSurfaceStore } from "@/stores/newSurface";
import { focusStore } from "@/stores/focus";
import { settingsPageStore } from "@/stores/settingsPage";
import { workspacePageStore } from "@/stores/workspacePage";
import {
  currentSurface,
  surfaceStore,
  useSurface,
  type Surface,
} from "@/stores/surface";

interface ColumnSources {
  homeOpen: boolean;
  newOpen: boolean;
  viewMode: ColumnContext["viewMode"];
  needsYou: number;
  changes: number;
  focus: boolean;
  keyboardUp: boolean;
  paneCount: number;
  settingsDetail: boolean;
  liveOpen: boolean;
  working: boolean;
  sheet: ColumnContext["sheet"];
  changesOpen: boolean;
  native: boolean;
  projectSettings: boolean;
}

function contextFrom(s: ColumnSources): ColumnContext {
  return {
    // Over the home (where it covers the pane) or under New, no view shows
    viewMode: s.homeOpen || s.newOpen ? null : s.viewMode,
    needsYou: s.needsYou,
    changes: s.changes,
    focus: s.focus,
    keyboardUp: s.keyboardUp,
    paneCount: s.paneCount,
    canGoBack: s.settingsDetail,
    native: s.native,
    liveOpen: s.liveOpen,
    working: s.working,
    sheet: s.sheet,
    projectSettings: s.projectSettings,
    changesOpen: s.changesOpen,
  };
}

/** The web's column, bar or tab bar: the items and what they were for */
export function useColumn(
  keyboardUp: boolean,
  native: boolean
): { surface: Surface; mode: LayoutMode; items: ColumnItem[] } {
  const nav = useSnapshot(mobileNavStore);
  const { open: newOpen } = useSnapshot(newSurfaceStore);
  const { on: focus } = useSnapshot(focusStore);
  const { paneCount } = useSnapshot(surfaceStore);
  const { detail: settingsDetail } = useSnapshot(settingsPageStore);
  const { mode } = useSnapshot(layoutStore);
  const { page } = useSnapshot(workspacePageStore);
  const surface = useSurface();
  const ctx = contextFrom({
    homeOpen: nav.homeOpen,
    newOpen,
    viewMode: nav.viewMode,
    needsYou: nav.needsYou,
    changes: nav.changes,
    focus,
    keyboardUp,
    paneCount,
    settingsDetail,
    liveOpen: nav.liveOpen,
    working: nav.working,
    sheet: nav.sheet,
    changesOpen: nav.changesOpen,
    native,
    projectSettings: page?.kind === "projectSettings",
  });
  return { surface, mode, items: columnFor(surface, mode, ctx) };
}

/** Where the page draws its own bar, so the app's column steps aside */
export const PAGE_BARS: LayoutMode[] = ["phone", "tabletop"];

/**
 * What the iOS app's column shows now, outside React: the surface, its
 * items without the web icons ([] where the page draws its own tab bar or
 * tabletop bar), whether the first one is back, and what its More menu
 * needs: the live activity showing and the wide layout
 */
export function nativeColumn(): {
  surface: Surface;
  column: NativeColumnItem[];
  canGoBack: boolean;
  liveOpen: boolean;
  wide: boolean;
} {
  const surface = currentSurface();
  const mode = layoutStore.mode;
  const items = columnFor(
    surface,
    mode,
    contextFrom({
      homeOpen: mobileNavStore.homeOpen,
      newOpen: newSurfaceStore.open,
      viewMode: mobileNavStore.viewMode,
      needsYou: mobileNavStore.needsYou,
      changes: mobileNavStore.changes,
      focus: focusStore.on,
      keyboardUp: mobileNavStore.nativeKeyboard,
      paneCount: surfaceStore.paneCount,
      settingsDetail: settingsPageStore.detail,
      liveOpen: mobileNavStore.liveOpen,
      working: mobileNavStore.working,
      sheet: mobileNavStore.sheet,
      changesOpen: mobileNavStore.changesOpen,
      native: true,
      projectSettings: workspacePageStore.page?.kind === "projectSettings",
    })
  );
  const column = PAGE_BARS.includes(mode)
    ? []
    : items.map(({ icon: _icon, ...rest }) => rest);
  return {
    surface,
    column,
    canGoBack: items[0]?.id === "back",
    liveOpen: mobileNavStore.liveOpen,
    wide: WIDE.includes(mode),
  };
}
