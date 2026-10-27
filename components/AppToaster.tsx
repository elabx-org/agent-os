"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

/**
 * Toasts at the top: centred, or on the open Duo's right page instead of
 * across the fold (html[data-hinge], set by useHinge)
 */
export function AppToaster() {
  const [hinge, setHinge] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setHinge(root.hasAttribute("data-hinge"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributeFilter: ["data-hinge"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      position={hinge ? "top-right" : "top-center"}
      closeButton
      // Clear of the status strip, and of the iOS app's system column
      offset={{ top: "max(16px, env(safe-area-inset-top))" }}
      mobileOffset={{
        top: "max(12px, env(safe-area-inset-top))",
        left: "12px",
        right: "calc(12px + env(safe-area-inset-right))",
      }}
      toastOptions={{
        className: "!bg-card !border-border !text-foreground !shadow-lg",
        classNames: { description: "!text-muted-foreground" },
      }}
    />
  );
}
