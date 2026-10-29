"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { useScriptRunLog } from "@/hooks/useProjectConfig";
import { cn } from "@/lib/utils";
import { stripAnsi } from "./script-view";

/**
 * M3 (U3.2): pieces the Scripts sheet and the project page share: the
 * round play/stop button, the log tail and a clock for the ages.
 */

/** The mocks' .run: a 44px round button (36 on the project page) */
export function RoundButton({
  kind,
  label,
  busy,
  small,
  onClick,
}: {
  kind: "play" | "stop";
  label: string;
  busy?: boolean;
  small?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "border-foreground/12 bg-foreground/8 active:bg-foreground/15 [@media(pointer:fine)]:hover:bg-foreground/12 relative grid flex-none place-items-center rounded-full border disabled:opacity-60",
        small
          ? "h-9 w-9 after:absolute after:-inset-1 after:content-['']"
          : "h-11 w-11",
        kind === "stop" ? "text-red-500 dark:text-red-300" : "text-foreground"
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : kind === "play" ? (
        <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" />
      ) : (
        <Square className="h-3.5 w-3.5" fill="currentColor" />
      )}
    </button>
  );
}

/** The running card's last lines of output (.out), polled while it runs */
export function LogTail({
  runId,
  lines = 3,
  live,
  className,
}: {
  runId: string;
  lines?: number;
  live: boolean;
  className?: string;
}) {
  const { data, isLoading } = useScriptRunLog(runId, { lines, live });
  const shown = (data ?? []).map(stripAnsi).slice(-lines);
  return (
    <div
      aria-label="Last output"
      className={cn(
        "rounded-xl bg-[var(--block)] px-3 py-2 font-mono text-[12px] leading-[1.6] text-[#3A3A3C] dark:text-[#C7C7CC]",
        className
      )}
    >
      {shown.length ? (
        shown.map((line, i) => (
          <div
            key={i}
            className={cn(
              "truncate whitespace-pre",
              i < shown.length - 1 && "text-muted-foreground"
            )}
          >
            {line || " "}
          </div>
        ))
      ) : (
        <div className="text-muted-foreground">
          {isLoading ? "…" : "No output yet"}
        </div>
      )}
    </div>
  );
}

/** Re-renders every `ms` so "14m" and "20m ago" keep up */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** One .row whose main part may be a button, with buttons beside it */
export function ScriptRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  className,
}: {
  leading: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const main = (
    <>
      {leading}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[16px]">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground mt-0.5 block truncate text-[13px]">
            {subtitle}
          </span>
        )}
      </span>
    </>
  );
  return (
    <div className={cn("row", className)}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-3 active:opacity-70"
        >
          {main}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{main}</div>
      )}
      {trailing}
    </div>
  );
}
