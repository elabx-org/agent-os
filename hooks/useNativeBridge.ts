"use client";

import { useEffect, useRef } from "react";
import { subscribeKey } from "valtio/utils";
import {
  isNative,
  onNativeEvent,
  postToNative,
  type NativeNavAction,
} from "@/lib/native-bridge";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import {
  closeSettings,
  openSettings,
  settingsPageStore,
} from "@/stores/settingsPage";
import { startClientLog } from "@/lib/client-log";

interface NativeBridgeOptions {
  waitingCount: number;
  openSessions: () => void;
  openFind: () => void;
  openNewSession: () => void;
}

/**
 * Inside the iOS app: answers its navigation (the system bar holds what the
 * web NavRail shows in Safari) and reports what the bar needs to show.
 */
export function useNativeBridge({
  waitingCount,
  openSessions,
  openFind,
  openNewSession,
}: NativeBridgeOptions) {
  const handlers = useRef({ openSessions, openFind, openNewSession });
  handlers.current = { openSessions, openFind, openNewSession };

  useEffect(() => {
    if (!isNative()) return;
    mobileNavStore.railActive = true;

    const nav = (action: NativeNavAction) => {
      const { viewMode } = mobileNavStore;
      // Settings covers the app: anything else in the bar leaves it
      if (action !== "settings") closeSettings();
      switch (action) {
        case "inbox":
          return mobileNavActions.setInboxOpen(true);
        case "sessions":
          return handlers.current.openSessions();
        case "find":
          return handlers.current.openFind();
        case "new":
          return handlers.current.openNewSession();
        case "settings":
          return openSettings();
        // Like the rail: the current view again opens the session list
        case "chat":
        case "terminal":
          return viewMode === action
            ? handlers.current.openSessions()
            : mobileNavActions.requestViewMode(action);
        default:
          return mobileNavActions.requestViewMode(action);
      }
    };

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
      if (event.type === "nav") nav(event.action);
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

  // The same event opens Settings in a browser too (tests, ?fold=v trials)
  useEffect(() => {
    if (isNative()) return;
    return onNativeEvent((event) => {
      if (event.type === "nav" && event.action === "settings") openSettings();
    });
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    const report = () =>
      postToNative({
        type: "state",
        viewMode: mobileNavStore.viewMode,
        waiting: waitingCount,
        changes: mobileNavStore.changes,
        background: getComputedStyle(document.body).backgroundColor,
        settings: settingsPageStore.open,
      });
    report();
    const stopView = subscribeKey(mobileNavStore, "viewMode", report);
    const stopChanges = subscribeKey(mobileNavStore, "changes", report);
    const stopSettings = subscribeKey(settingsPageStore, "open", report);
    // A theme change repaints the page: tell the app the new background
    const themes = new MutationObserver(report);
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => {
      stopView();
      stopChanges();
      stopSettings();
      themes.disconnect();
    };
  }, [waitingCount]);
}
