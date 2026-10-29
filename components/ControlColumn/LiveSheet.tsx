"use client";

import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import { LiveActivitySheet } from "@/components/Session/ActivityStrip";
import { mobileNavStore } from "@/stores/mobileNav";

/**
 * The column's Live activity where the rail has no room beside the pane: a
 * sheet over it (the open Duo shows the rail on its right page instead)
 */
export function LiveSheet({
  session,
}: {
  session: Session | null | undefined;
}) {
  const { liveOpen, railShown } = useSnapshot(mobileNavStore);
  if (!session) return null;
  return (
    <LiveActivitySheet
      session={session}
      active
      open={liveOpen && !railShown}
      onOpenChange={(open) => {
        mobileNavStore.liveOpen = open;
      }}
    />
  );
}
