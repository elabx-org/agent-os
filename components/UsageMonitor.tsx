"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface UsageBlock {
  utilization: number | null;
  resets_at: string | null;
}

interface ExtraUsage {
  is_enabled: boolean;
  utilization: number | null;
  used_credits: number | null;
  monthly_limit: number | null;
}

interface UsageData {
  five_hour: UsageBlock;
  seven_day: UsageBlock;
  seven_day_sonnet: UsageBlock | null;
  seven_day_opus: UsageBlock | null;
  extra_usage: ExtraUsage;
  plan: string;
  error?: string;
}

async function fetchUsage(): Promise<UsageData> {
  const res = await fetch("/api/claude-usage");
  if (!res.ok) throw new Error("Failed to fetch usage");
  return res.json();
}

function barColor(pct: number): string {
  if (pct >= 80) return "bg-red-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-emerald-500";
}

function barTextColor(pct: number): string {
  if (pct >= 80) return "text-red-400";
  if (pct >= 50) return "text-amber-400";
  return "text-emerald-400";
}

function formatCountdown(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// Compact mini bar for the header
function MiniBar({
  label,
  pct,
}: {
  label: string;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground text-[10px] font-medium">
        {label}
      </span>
      <div className="bg-muted relative h-1.5 w-12 overflow-hidden rounded-full">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor(pct)}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={`text-[10px] font-medium tabular-nums ${barTextColor(pct)}`}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

// Larger bar for the detail dialog
function DetailBar({
  label,
  pct,
  resetsAt,
  subtitle,
}: {
  label: string;
  pct: number;
  resetsAt: string | null;
  subtitle?: string;
}) {
  const countdown = formatCountdown(resetsAt);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-sm font-medium">{label}</span>
          {subtitle && (
            <span className="text-muted-foreground ml-2 text-xs">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold tabular-nums ${barTextColor(pct)}`}>
            {Math.round(pct)}%
          </span>
          {countdown && (
            <span className="text-muted-foreground text-xs">
              resets in {countdown}
            </span>
          )}
        </div>
      </div>
      <div className="bg-muted relative h-2.5 w-full overflow-hidden rounded-full">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor(pct)}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function UsageMonitor() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isError } = useQuery<UsageData>({
    queryKey: ["claude-usage"],
    queryFn: fetchUsage,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });

  // Compute live countdowns for tooltip
  const tooltipText = useMemo(() => {
    if (!data) return "";
    const session = data.five_hour.utilization ?? 0;
    const weekly = data.seven_day.utilization ?? 0;
    const sessionReset = formatCountdown(data.five_hour.resets_at);
    const weeklyReset = formatCountdown(data.seven_day.resets_at);
    return `Session: ${Math.round(session)}%${sessionReset ? ` (${sessionReset})` : ""} | Weekly: ${Math.round(weekly)}%${weeklyReset ? ` (${weeklyReset})` : ""} | ${data.plan}`;
  }, [data]);

  // Don't render if no data or error
  if (!data || isError || data.error) return null;

  const sessionPct = data.five_hour.utilization ?? 0;
  const weeklyPct = data.seven_day.utilization ?? 0;

  return (
    <>
      {/* Compact header bar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setDialogOpen(true)}
            className="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-1 transition-colors"
          >
            <MiniBar label="Session" pct={sessionPct} />
            <div className="bg-border h-3 w-px" />
            <MiniBar label="Weekly" pct={weeklyPct} />
            <div className="bg-border h-3 w-px" />
            <span className="text-muted-foreground text-[10px] font-medium">
              {data.plan}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{tooltipText}</p>
          <p className="text-muted-foreground text-[10px]">
            Click for details
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Detail dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Usage
              <Badge variant="secondary" className="text-xs">
                {data.plan}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Session (5-hour) */}
            <DetailBar
              label="Session"
              pct={sessionPct}
              resetsAt={data.five_hour.resets_at}
              subtitle="5-hour window"
            />

            {/* Weekly (7-day) */}
            <DetailBar
              label="Weekly"
              pct={weeklyPct}
              resetsAt={data.seven_day.resets_at}
              subtitle="7-day window"
            />

            {/* Sonnet sub-limit */}
            {data.seven_day_sonnet &&
              data.seven_day_sonnet.utilization !== null && (
                <DetailBar
                  label="Sonnet"
                  pct={data.seven_day_sonnet.utilization}
                  resetsAt={data.seven_day_sonnet.resets_at}
                  subtitle="weekly sub-limit"
                />
              )}

            {/* Opus sub-limit */}
            {data.seven_day_opus &&
              data.seven_day_opus.utilization !== null && (
                <DetailBar
                  label="Opus"
                  pct={data.seven_day_opus.utilization}
                  resetsAt={data.seven_day_opus.resets_at}
                  subtitle="weekly sub-limit"
                />
              )}

            {/* Extra credits */}
            {data.extra_usage.is_enabled && (
              <div className="border-border space-y-1.5 rounded-lg border p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">Extra Credits</span>
                  {data.extra_usage.used_credits !== null &&
                    data.extra_usage.monthly_limit !== null && (
                      <span className="text-muted-foreground text-xs">
                        ${(data.extra_usage.used_credits / 100).toFixed(2)} / $
                        {(data.extra_usage.monthly_limit / 100).toFixed(2)}
                      </span>
                    )}
                </div>
                {data.extra_usage.utilization !== null && (
                  <div className="bg-muted relative h-2.5 w-full overflow-hidden rounded-full">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor(data.extra_usage.utilization)}`}
                      style={{
                        width: `${Math.min(data.extra_usage.utilization, 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
