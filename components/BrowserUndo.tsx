"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { onNativeEvent, postToNative } from "@/lib/native-bridge";

/** Undo for a page closed from the iOS app's Pages menu */
export function BrowserUndo() {
  useEffect(
    () =>
      onNativeEvent((event) => {
        if (event.type !== "browser" || !event.closed) return;
        toast(`Closed ${event.closed.title}`, {
          id: "browser-closed",
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => postToNative({ type: "browser", action: "undo" }),
          },
        });
      }),
    []
  );
  return null;
}
