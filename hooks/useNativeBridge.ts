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
      switch (action) {
        case "inbox":
          return mobileNavActions.setInboxOpen(true);
        case "sessions":
          return handlers.current.openSessions();
        case "find":
          return handlers.current.openFind();
        case "new":
          return handlers.current.openNewSession();
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

    return onNativeEvent((event) => {
      if (event.type === "nav") nav(event.action);
      else if (event.type === "keyboard")
        mobileNavStore.nativeKeyboard = event.visible;
    });
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    const report = () =>
      postToNative({
        type: "state",
        viewMode: mobileNavStore.viewMode,
        waiting: waitingCount,
      });
    report();
    return subscribeKey(mobileNavStore, "viewMode", report);
  }, [waitingCount]);
}
