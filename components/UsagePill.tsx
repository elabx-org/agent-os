"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DetailBar, useClaudeUsage } from "@/components/UsageMonitor";
import { useMinimaxUsage } from "@/components/MinimaxUsageMonitor";
import { cn } from "@/lib/utils";

/** Claude's spark, in Claude's orange whatever the theme */
export function ClaudeMark({ size = 13 }: { size?: number }) {
  const rays = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke="#D97757"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {rays.map((a) => (
        <path
          key={a}
          d={`M12 12L12 ${a % 45 ? 4.5 : 2}`}
          transform={`rotate(${a * 2} 12 12)`}
        />
      ))}
    </svg>
  );
}

/** MiniMax: an M on a small tile (a stand-in, not their logo) */
export function MinimaxMark({ size = 13 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="bg-muted text-foreground inline-grid shrink-0 place-items-center rounded"
      style={{ width: size + 3, height: size + 3 }}
    >
      <svg
        width={size - 2}
        height={size - 2}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 18V7l4 6 4-6 4 6 4-6v11" />
      </svg>
    </span>
  );
}

/** Quiet until half used, then amber, then red */
function level(pct: number): string {
  if (pct >= 80) return "text-red-400";
  if (pct >= 50) return "text-amber-400";
  return "text-foreground";
}

function Pct({ pct, className }: { pct: number; className?: string }) {
  return <span className={cn(level(pct), className)}>{Math.round(pct)}%</span>;
}

/**
 * The home's usage: each provider's mark and its numbers, one tap from the
 * Usage sheet. Needs an @container/top ancestor; when it's narrow, Claude's
 * weekly % goes first, then only the marks and the highest % stay.
 */
export function UsagePill() {
  const [open, setOpen] = useState(false);
  const { data: claude } = useClaudeUsage();
  const { data: minimax } = useMinimaxUsage();

  const c = claude && !claude.error ? claude : null;
  const m = minimax?.data ?? null;
  if (!c && !m) return null;

  const session = c?.five_hour.utilization ?? 0;
  const weekly = c?.seven_day.utilization ?? 0;
  const mPct = m && m.total > 0 ? ((m.total - m.remains) / m.total) * 100 : 0;
  const highest = Math.max(c ? Math.max(session, weekly) : 0, m ? mPct : 0);

  const label = [
    c &&
      `Claude ${Math.round(session)}% of 5 hours, ${Math.round(weekly)}% of the week`,
    m && `MiniMax ${Math.round(mPct)}%`,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Usage: ${label}`}
        className="bg-secondary text-muted-foreground hover:bg-accent relative flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap tabular-nums after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
      >
        {c && (
          <>
            <ClaudeMark />
            <span
              className={cn(
                "flex items-center gap-1",
                m && "@max-[300px]/top:hidden"
              )}
            >
              <Pct pct={session} />
              <span className={cn(m && "@max-[350px]/top:hidden")}>·</span>
              <Pct
                pct={weekly}
                className={cn(m && "@max-[350px]/top:hidden")}
              />
            </span>
          </>
        )}
        {c && m && (
          <span
            aria-hidden="true"
            className="bg-border mx-0.5 h-3 w-px @max-[300px]/top:hidden"
          />
        )}
        {m && (
          <>
            <MinimaxMark />
            <Pct pct={mPct} className={cn(c && "@max-[300px]/top:hidden")} />
          </>
        )}
        {c && m && (
          <Pct pct={highest} className="hidden @max-[300px]/top:inline" />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Usage</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pb-1">
            {c && (
              <section className="bg-secondary space-y-3 rounded-[14px] p-3.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ClaudeMark size={15} />
                  Claude
                  <span className="text-muted-foreground font-normal">
                    · {c.plan}
                  </span>
                </h3>
                <DetailBar
                  label="5 hours"
                  pct={session}
                  resetsAt={c.five_hour.resets_at}
                />
                <DetailBar
                  label="Week"
                  pct={weekly}
                  resetsAt={c.seven_day.resets_at}
                />
                {c.seven_day_sonnet?.utilization != null && (
                  <DetailBar
                    label="Sonnet"
                    pct={c.seven_day_sonnet.utilization}
                    resetsAt={c.seven_day_sonnet.resets_at}
                    subtitle="weekly"
                  />
                )}
                {c.seven_day_opus?.utilization != null && (
                  <DetailBar
                    label="Opus"
                    pct={c.seven_day_opus.utilization}
                    resetsAt={c.seven_day_opus.resets_at}
                    subtitle="weekly"
                  />
                )}
              </section>
            )}
            {m && (
              <section className="bg-secondary space-y-3 rounded-[14px] p-3.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <MinimaxMark size={14} />
                  MiniMax
                  <span className="text-muted-foreground font-normal">
                    · Coding plan
                  </span>
                </h3>
                <DetailBar
                  label="Prompts"
                  pct={mPct}
                  resetsAt={null}
                  subtitle={`${m.remains.toLocaleString()} of ${m.total.toLocaleString()} left`}
                />
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
