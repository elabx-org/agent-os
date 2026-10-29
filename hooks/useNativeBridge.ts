"use client";

import { useEffect } from "react";
import { subscribe } from "valtio";
import { subscribeKey } from "valtio/utils";
import { columnOrderStore } from "@/stores/columnOrder";
import {
  isNative,
  nativeCaps,
  onNativeEvent,
  postToNative,
  themeAccent,
  type NativeState,
} from "@/lib/native-bridge";
import { runNav } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";
import { settingsPageStore } from "@/stores/settingsPage";
import { workspacePageStore } from "@/stores/workspacePage";
import { focusStore } from "@/stores/focus";
import { newSurfaceStore } from "@/stores/newSurface";
import { surfaceStore } from "@/stores/surface";
import { layoutStore } from "@/hooks/useLayoutMode";
import { nativeColumn } from "@/components/ControlColumn/columnState";
import { startClientLog } from "@/lib/client-log";
import { nativeViewMode } from "@/lib/agent-views";
import { agentTreeStore } from "@/stores/agentTree";

interface NativeBridgeOptions {
  waitingCount: number;
}

/**
 * Inside the iOS app: answers its navigation (the system bar holds what the
 * web column shows in Safari) and reports what the bar needs to show.
 */
export function useNativeBridge({ waitingCount }: NativeBridgeOptions) {
  useEffect(() => {
    if (!isNative()) return;
    mobileNavStore.railActive = true;

    // iOS can put the keyboard away while the text box keeps focus; a tap on
    // an already-focused box then brings back neither keyboard nor caret
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const keyboardHidden = () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        const el = document.activeElement;
        if (
          !mobileNavStore.nativeKeyboard &&
          (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)
        )
          el.blur();
      }, 300);
    };

    const stop = onNativeEvent((event) => {
      if (event.type === "nav") runNav(event.action);
      else if (event.type === "keyboard") {
        mobileNavStore.nativeKeyboard = event.visible;
        if (!event.visible) keyboardHidden();
      }
    });
    const stopLog = startClientLog();
    return () => {
      clearTimeout(blurTimer);
      stop();
      stopLog();
    };
  }, []);

  // The same events open Settings and toggle Focus in a browser too (tests,
  // ?fold=v trials)
  useEffect(() => {
    if (isNative()) return;
    return onNativeEvent((event) => {
      if (
        event.type === "nav" &&
        (event.action === "settings" || event.action === "focus")
      )
        runNav(event.action);
    });
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    // App builds that draw the column get it, with what it's for
    const column = nativeCaps().column;
    let last = "";
    const report = () => {
      const state: NativeState = {
        type: "state",
        viewMode: nativeViewMode(mobileNavStore.viewMode),
        waiting: waitingCount,
        changes: mobileNavStore.changes,
        background: getComputedStyle(document.body).backgroundColor,
        settings: settingsPageStore.open,
        page: workspacePageStore.page?.kind,
        focus: focusStore.on,
        focusDot: focusStore.on && mobileNavStore.needsYou > 0,
        accent: themeAccent(),
        scheme: document.documentElement.classList.contains("light")
          ? "light"
          : "dark",
        ...(column && nativeColumn()),
      };
      // Many stores feed it: send only what changed
      const json = JSON.stringify(state);
      if (json === last) return;
      last = json;
      postToNative(state);
    };
    report();
    const stops = [
      subscribeKey(mobileNavStore, "viewMode", report),
      subscribeKey(mobileNavStore, "changes", report),
      subscribeKey(mobileNavStore, "needsYou", report),
      subscribeKey(settingsPageStore, "open", report),
      subscribeKey(workspacePageStore, "page", report),
      subscribeKey(focusStore, "on", report),
      ...(column
        ? [
            subscribeKey(mobileNavStore, "homeOpen", report),
            subscribeKey(mobileNavStore, "homeTab", report),
            subscribeKey(mobileNavStore, "inboxOpen", report),
            subscribeKey(mobileNavStore, "liveOpen", report),
            subscribeKey(mobileNavStore, "nativeKeyboard", report),
            // A sheet over the session and a turn in progress change the
            // closed column (× | ✓, × | Changes, Stop)
            subscribeKey(mobileNavStore, "sheet", report),
            // The move sheet's × | Move session, × | Cancel move or × (M5)
            subscribeKey(mobileNavStore, "sheetAction", report),
            subscribeKey(mobileNavStore, "working", report),
            subscribeKey(mobileNavStore, "agentCount", report),
            subscribeKey(agentTreeStore, "showFinished", report),
            subscribeKey(agentTreeStore, "allCollapsed", report),
            subscribeKey(agentTreeStore, "detailOpen", report),
            subscribeKey(newSurfaceStore, "open", report),
            subscribeKey(surfaceStore, "home", report),
            subscribeKey(surfaceStore, "paneCount", report),
            subscribeKey(surfaceStore, "searchOpen", report),
            subscribeKey(settingsPageStore, "detail", report),
            subscribeKey(layoutStore, "mode", report),
            subscribe(columnOrderStore, report),
          ]
        : []),
    ];
    // A theme change repaints the page: tell the app the new colours
    const themes = new MutationObserver(report);
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-accent", "style"],
    });
    return () => {
      stops.forEach((stop) => stop());
      themes.disconnect();
    };
  }, [waitingCount]);
}
