"use client";

import { useClaudeUsage } from "@/components/UsageMonitor";
import { useMinimaxUsage } from "@/components/MinimaxUsageMonitor";
import { formatReset } from "@/lib/usage-reset";
import { openSettings } from "@/stores/settingsPage";
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

/**
 * phone: the regular iPhone's (54px meters); closed: the closed Duo's (60px);
 * wide: the open Duo's left page and the desktop sidebar, taller with each
 * window's reset under its meter
 */
export type UsagePillVariant = "phone" | "closed" | "wide";

const VARIANT = {
  phone: { pill: "h-11 gap-3 rounded-[22px] px-3", meter: "w-[54px]" },
  closed: { pill: "h-11 gap-3.5 rounded-[22px] px-3.5", meter: "w-[60px]" },
  wide: { pill: "h-[52px] gap-4 rounded-[26px] px-4", meter: "w-[84px]" },
} as const;

/** Only past 80% does the number warn */
function level(pct: number): string {
  return pct >= 80 ? "text-red-600 dark:text-red-400" : "text-foreground";
}

function Meter({
  label,
  pct,
  reset,
  className,
}: {
  label: string;
  pct: number;
  /** "resets 4:10 pm", wide only */
  reset?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-col gap-[5px]", className)}>
      <span className="flex items-center justify-between gap-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold", level(pct))}>
          {Math.round(pct)}%
        </span>
      </span>
      <span className="bg-foreground/10 h-1 overflow-hidden rounded-full">
        <span
          className="dark:bg-meter block h-full min-w-1 rounded-full bg-violet-600"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </span>
      {reset !== undefined && (
        <span className="text-[11px] text-[#6B6B70] dark:text-[#8E8E93]">
          {reset ? `resets ${reset}` : "\u00a0"}
        </span>
      )}
    </span>
  );
}

/**
 * The home's usage: Claude's session and week as two violet meters (MiniMax's
 * prompts when there's no Claude), one tap from Settings → Usage.
 */
export function UsagePill({
  variant = "closed",
  className,
}: {
  variant?: UsagePillVariant;
  className?: string;
}) {
  const { data: claude } = useClaudeUsage();
  const { data: minimax } = useMinimaxUsage();

  const c = claude && !claude.error ? claude : null;
  const m = minimax?.data ?? null;
  if (!c && !m) return null;

  const wide = variant === "wide";
  const { pill, meter } = VARIANT[variant];
  const session = c?.five_hour.utilization ?? 0;
  const weekly = c?.seven_day.utilization ?? 0;
  const sessionReset = formatReset(c?.five_hour.resets_at);
  const weekReset = formatReset(c?.seven_day.resets_at);
  const mPct = m && m.total > 0 ? ((m.total - m.remains) / m.total) * 100 : 0;

  // As the mock reads it: "Claude usage: session 3%, resets 4:10 pm; …"
  const resets = (iso: string | null | undefined) => {
    const when = formatReset(iso, { style: "long" });
    return wide && when ? `, resets ${when}` : "";
  };
  const label = [
    c &&
      `Claude usage: session ${Math.round(session)}%${resets(c.five_hour.resets_at)}; week ${Math.round(weekly)}%${resets(c.seven_day.resets_at)}`,
    m && `MiniMax ${Math.round(mPct)}%`,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <button
      type="button"
      onClick={() => openSettings("usage")}
      aria-label={label}
      className={cn(
        "glass flex shrink-0 items-center text-xs leading-none whitespace-nowrap tabular-nums active:opacity-80",
        pill,
        className
      )}
    >
      {c ? (
        <>
          <Meter
            label="Session"
            pct={session}
            reset={wide ? sessionReset : undefined}
            className={meter}
          />
          <Meter
            label="Week"
            pct={weekly}
            reset={wide ? weekReset : undefined}
            className={meter}
          />
        </>
      ) : (
        <Meter
          label="MiniMax"
          pct={mPct}
          reset={wide ? "" : undefined}
          className={meter}
        />
      )}
    </button>
  );
}
