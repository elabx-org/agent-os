"use client";

import { useSnapshot } from "valtio";
import {
  WIDE,
  columnFor,
  columnKindFor,
  moreItems,
  moreExtras,
  agentsMoreItem,
  type ColumnContext,
  type ColumnItem,
  type ColumnOrder,
} from "@/lib/column-spec";
import { columnOrderStore } from "@/stores/columnOrder";
import type { NativeColumnItem } from "@/lib/native-bridge";
import { layoutStore, type LayoutMode } from "@/hooks/useLayoutMode";
import { mobileNavStore } from "@/stores/mobileNav";
import { agentTreeStore } from "@/stores/agentTree";
import { newSurfaceStore } from "@/stores/newSurface";
import { focusStore } from "@/stores/focus";
import { settingsPageStore } from "@/stores/settingsPage";
import { workspacePageStore } from "@/stores/workspacePage";
import { runningStore } from "@/stores/running";
import { sessionActionsStore } from "@/stores/sessionActions";
import { backStore } from "@/stores/back";
import { backTarget } from "@/lib/nav-actions";
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
  sheetAction: ColumnContext["sheetAction"];
  changesOpen: boolean;
  behind: boolean;
  native: boolean;
  order: ColumnOrder;
  agents: number;
  showFinished: boolean;
  allCollapsed: boolean;
  agentDetail: boolean;
  projectSettings: boolean;
  backLabel: string;
  settingsFrom: "needs" | null;
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
    sheetAction: s.sheetAction,
    agents: s.agents,
    showFinished: s.showFinished,
    allCollapsed: s.allCollapsed,
    agentDetail: s.agentDetail,
    projectSettings: s.projectSettings,
    changesOpen: s.changesOpen,
    behind: s.behind,
    order: s.order,
    backLabel: s.backLabel,
    settingsFrom: s.settingsFrom ?? undefined,
  };
}

/**
 * Back's label (backTarget), read again when anything it goes by changes:
 * the snapshots only track what's read, and backTarget reads the stores
 */
export function useBackLabel(): string {
  const back = useSnapshot(backStore);
  const pages = useSnapshot(workspacePageStore);
  const settings = useSnapshot(settingsPageStore);
  const surface = useSnapshot(surfaceStore);
  const nav = useSnapshot(mobileNavStore);
  const { sessionId } = useSnapshot(runningStore);
  const { open: newOpen } = useSnapshot(newSurfaceStore);
  const { detailOpen } = useSnapshot(agentTreeStore);
  const { mode } = useSnapshot(layoutStore);
  void [back.pageLabel, back.viewLabel, back.origin, back.projectNames];
  void [pages.page, pages.previous, sessionId, newOpen, detailOpen, mode];
  void [settings.open, settings.detail, settings.returnTo];
  void [surface.home, surface.behind, surface.searchOpen];
  void [nav.viewMode, nav.conversationView, nav.inboxOpen, nav.homeTab];
  void [nav.liveOpen, nav.changesOpen];
  return backTarget().label;
}

/** The web's column, bar or tab bar: the items and what they were for */
export function useColumn(
  keyboardUp: boolean,
  native: boolean
): { surface: Surface; mode: LayoutMode; items: ColumnItem[] } {
  const nav = useSnapshot(mobileNavStore);
  const { open: newOpen } = useSnapshot(newSurfaceStore);
  const { on: focus } = useSnapshot(focusStore);
  const { paneCount, behind } = useSnapshot(surfaceStore);
  const { detail: settingsDetail, returnTo } = useSnapshot(settingsPageStore);
  const backLabel = useBackLabel();
  const { mode } = useSnapshot(layoutStore);
  const tree = useSnapshot(agentTreeStore);
  const { page } = useSnapshot(workspacePageStore);
  const surface = useSurface();
  const { order } = useSnapshot(columnOrderStore);
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
    sheetAction: nav.sheetAction,
    changesOpen: nav.changesOpen,
    behind,
    native,
    order: order as ColumnOrder,
    agents: nav.agentCount,
    showFinished: tree.showFinished,
    allCollapsed: tree.allCollapsed,
    agentDetail: tree.detailOpen,
    projectSettings: page?.kind === "projectSettings",
    backLabel,
    settingsFrom: returnTo,
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
  more: NativeColumnItem[];
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
      sheetAction: mobileNavStore.sheetAction,
      changesOpen: mobileNavStore.changesOpen,
      behind: surfaceStore.behind,
      native: true,
      order: columnOrderStore.order,
      agents: mobileNavStore.agentCount,
      showFinished: agentTreeStore.showFinished,
      allCollapsed: agentTreeStore.allCollapsed,
      agentDetail: agentTreeStore.detailOpen,
      projectSettings: workspacePageStore.page?.kind === "projectSettings",
      backLabel: backTarget().label,
      settingsFrom: settingsPageStore.returnTo,
    })
  );
  const kind = columnKindFor(surface, mode);
  const agentsMore =
    surface === "session" || surface === "beside"
      ? agentsMoreItem(
          mobileNavStore.agentCount,
          mobileNavStore.agentLive,
          mobileNavStore.viewMode
        )
      : null;
  const column = PAGE_BARS.includes(mode)
    ? []
    : items.map(({ icon: _icon, ...rest }) => rest);
  return {
    surface,
    column,
    canGoBack: items[0]?.id === "back",
    liveOpen: mobileNavStore.liveOpen,
    wide: WIDE.includes(mode),
    // What the column shows already isn't offered again
    more: [
      ...(kind
        ? moreItems(
            kind,
            columnOrderStore.order,
            mobileNavStore.viewMode,
            // The closed Duo's session column, cut down above the keyboard
            mode === "duo-closed" &&
              mobileNavStore.nativeKeyboard &&
              (surface === "session" || surface === "beside"),
            WIDE.includes(mode)
          )
        : []),
      ...(agentsMore ? [agentsMore] : []),
      ...moreExtras({
        surface,
        viewMode: mobileNavStore.viewMode,
        shown: items.map((it) => it.id),
        running: runningStore.enabled,
        session: {
          scripts: sessionActionsStore.scripts,
          settle: sessionActionsStore.settle,
          // Not from the app's menu: a nav message isn't a tap, so WebKit
          // won't let the page write the clipboard (the web's More can)
          copyId: false,
        },
      }),
    ]
      .filter((it) => !items.some((shown) => shown.id === it.id))
      .map(({ icon: _icon, ...rest }) => rest),
  };
}
