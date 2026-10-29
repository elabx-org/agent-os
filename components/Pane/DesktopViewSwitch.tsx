"use client";

import { Activity } from "lucide-react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import { runNav } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";

/**
 * The desktop shell has no control column: its views switch in the header
 * (Desk-Chat's Chat | Terminal | Changes), and Live activity opens from
 * here whenever the rail is off (two panes, a narrow window)
 */
export function DesktopLiveButton() {
  const { railShown, liveOpen } = useSnapshot(mobileNavStore);
  if (railShown) return null;
  return (
    <button
      type="button"
      onClick={() => runNav("live")}
      aria-label="Live activity"
      aria-pressed={liveOpen}
      title="Live activity"
      className={cn(
        "hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        liveOpen ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Activity className="h-[18px] w-[18px]" />
    </button>
  );
}
