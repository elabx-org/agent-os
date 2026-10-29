"use client";

import { Sun } from "lucide-react";
import { useClaudeUsage } from "@/components/UsageMonitor";
import { formatReset } from "@/lib/usage-reset";
import { runNav } from "@/lib/nav-actions";
import { cn } from "@/lib/utils";

/** Only past 80% does the number warn (as the Now pill) */
function level(pct: number): string {
  return pct >= 80 ? "text-red-600 dark:text-red-400" : "text-foreground/90";
}

function Window({
  label,
  pct,
  reset,
  className,
}: {
  label: string;
  pct: number;
  /** "4:10 pm", "Mon" or empty */
  reset: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-[13px] tabular-nums">
        <span className="truncate">
          <span className="text-foreground/90">{label}</span>
          {reset && ` · resets ${reset}`}
        </span>
        <span className={cn("font-semibold", level(pct))}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="bg-foreground/10 h-1.5 overflow-hidden rounded-[3px]">
        <div
          className="bg-primary dark:bg-meter h-full min-w-1.5 rounded-[3px]"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The desktop sidebar's foot (Desk-Chat): Claude's session and week, each
 * with when it resets, the plan, and Settings. Nothing without Claude usage.
 */
export function UsageCard({ className }: { className?: string }) {
  const { data } = useClaudeUsage();
  const usage = data && !data.error ? data : null;

  return (
    <div
      className={cn(
        "bg-card flex flex-col gap-2 rounded-2xl p-3",
        !usage && "pt-1.5 pb-1.5",
        className
      )}
    >
      {usage && (
        <>
          <Window
            label="Session"
            pct={usage.five_hour.utilization ?? 0}
            reset={formatReset(usage.five_hour.resets_at)}
          />
          <Window
            label="Week"
            pct={usage.seven_day.utilization ?? 0}
            reset={formatReset(usage.seven_day.resets_at)}
            className="mt-1"
          />
        </>
      )}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-[13px]">
          {usage && usage.plan !== "Unknown" ? usage.plan : "AgentOS"}
        </span>
        <button
          type="button"
          onClick={() => runNav("settings")}
          aria-label="Settings"
          className="hover:bg-accent active:bg-accent flex h-8 w-8 items-center justify-center rounded-full"
        >
          <Sun className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}
