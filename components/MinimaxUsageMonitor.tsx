"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CodingPlanData {
  code: number;
  msg: string;
  data?: {
    remains: number;
    used: number;
    total: number;
  };
}

async function fetchUsage(): Promise<CodingPlanData> {
  const res = await fetch("/api/minimax-usage");
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

export function MinimaxUsageMonitor() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isError, isLoading } = useQuery<CodingPlanData>({
    queryKey: ["minimax-usage"],
    queryFn: fetchUsage,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });

  // Don't render if no data, loading, or error
  if (isLoading || isError || !data || !data.data) return null;

  const { remains, used, total } = data.data;
  const pct = total > 0 ? ((total - remains) / total) * 100 : 0;

  const tooltipText = `Remaining: ${remains.toLocaleString()} prompts | Used: ${used.toLocaleString()} / ${total.toLocaleString()}`;

  return (
    <>
      {/* Compact header bar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setDialogOpen(true)}
            className="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-1 transition-colors"
          >
            <MiniBar label="Minimax" pct={pct} />
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
            <DialogTitle>Minimax Coding Plan</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Remaining prompts */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Remaining Prompts</span>
                <span className={`text-sm font-semibold tabular-nums ${barTextColor(pct)}`}>
                  {remains.toLocaleString()}
                </span>
              </div>
              <div className="bg-muted relative h-2.5 w-full overflow-hidden rounded-full">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor(pct)}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>

            {/* Usage summary */}
            <div className="border-border flex justify-between rounded-lg border p-3 text-sm">
              <div className="text-center">
                <div className="text-muted-foreground text-xs">Used</div>
                <div className="font-semibold">{used.toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground text-xs">Total</div>
                <div className="font-semibold">{total.toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground text-xs">Remaining</div>
                <div className="font-semibold">{remains.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
