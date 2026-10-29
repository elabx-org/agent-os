"use client";

import { useSnapshot } from "valtio";
import { ChevronRight } from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useSessionActivity } from "@/hooks/useSessionActivity";
import { mobileNavStore } from "@/stores/mobileNav";
import { StateDot } from "@/components/a/StateDot";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { LiveActivity } from "./LiveActivity";
import { formatAge, workingLine } from "./activity-format";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One card under the session header saying what it's doing (N-Queue's
 * status card: "Working · Editing ActivityStrip.tsx  4m"), for screens with
 * no room for the live activity rail. Tapping it opens the Live activity.
 */
export function ActivityStrip({
  session,
  active = true,
  className,
}: {
  session: Session;
  active?: boolean;
  className?: string;
}) {
  // Hidden while typing, as the slim header (the iOS app reports its keyboard)
  const { nativeKeyboard } = useSnapshot(mobileNavStore);
  const { state, now, files, agents, workflows } = useSessionActivity(session, {
    active,
  });
  const needs = state === "needs";
  const work = state === "work";

  const counts = [
    files.count > 0 && plural(files.count, "file"),
    // Live ones only; the rail lists the finished too
    agents.running > 0 && plural(agents.running, "agent"),
    workflows.running > 0 && plural(workflows.running, "workflow"),
  ].filter(Boolean);

  return (
    <div
      className={cn(
        // The header's side insets, so the two line up
        "kb-compact-hide bg-background shrink-0 pt-1 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(0.5rem+env(safe-area-inset-left))]",
        nativeKeyboard && "hidden",
        className
      )}
    >
      <StatusCardButton
        state={state}
        onOpen={openLiveSheet}
        label={
          needs ? (
            <span className="dark:text-needs font-semibold text-amber-600">
              Waiting for you
            </span>
          ) : work ? (
            <>
              <span className="dark:text-work font-semibold text-emerald-600">
                Working
              </span>
              {now.label !== "Working" && ` · ${workingLine(now)}`}
            </>
          ) : (
            now.label
          )
        }
        right={[
          counts.length > 0 ? counts.join(" · ") : null,
          (work || needs) && now.startedAt !== undefined
            ? formatAge(Date.now() - now.startedAt)
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
    </div>
  );
}

/**
 * The column's Live activity (LiveSheet, for the focused session: tapping
 * a pane focuses it), so the column shows close and Stop beside it
 */
export function openLiveSheet() {
  mobileNavStore.liveOpen = true;
}

/** The status card as a button that opens the Live activity */
export function StatusCardButton({
  state,
  label,
  right,
  onOpen,
  className,
}: {
  state: ReturnType<typeof useSessionActivity>["state"];
  label: React.ReactNode;
  right?: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        "status-card active:bg-accent hover:bg-accent/60 w-full min-w-0 touch-manipulation text-left whitespace-nowrap",
        state === "work" && "tone-work",
        state === "needs" && "tone-needs",
        className
      )}
    >
      <StateDot state={state} className="mr-1" />
      <span className="text-foreground min-w-0 flex-1 truncate">{label}</span>
      {right && (
        <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">
          {right}
        </span>
      )}
      <ChevronRight
        aria-hidden="true"
        className="text-muted-foreground h-4 w-4 shrink-0"
      />
    </button>
  );
}

/** The Live activity as a sheet (E-Live), for screens with no room beside the pane */
export function LiveActivitySheet({
  session,
  active,
  open,
  onOpenChange,
}: {
  session: Session;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sheet-surface bg-[var(--sheet)]">
        <SheetDescription className="sr-only">
          What this session is doing, its plan, changes and agents
        </SheetDescription>
        {/* Mounted only while open: it looks up the PR too */}
        {open && (
          <LiveActivity
            session={session}
            active={active}
            variant="sheet"
            title={(text) => (
              <SheetTitle className="text-[20px] leading-tight font-bold tracking-normal">
                {text}
              </SheetTitle>
            )}
            onNavigate={() => onOpenChange(false)}
            className="pt-2"
          />
        )}
        {!open && <SheetTitle className="sr-only">Live activity</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}
