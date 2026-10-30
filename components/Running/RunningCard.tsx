"use client";

import { MonitorPlay } from "lucide-react";
import { useFlag } from "@/hooks/useFlags";
import { shortAge } from "@/components/MissionControl/now-summary";
import type { Session } from "@/lib/db";
import { openPage } from "@/stores/workspacePage";
import { useRunning, useStopServer } from "./data";

const POLL_MS = 10_000;

/**
 * In a session's chat (N-PortChat): the servers it started and left
 * running, with the link the user reaches them by, Open preview and Stop.
 * Nothing while Labs' Running is off or nothing runs
 */
export function RunningCardSlot({
  session,
  active,
}: {
  session: Session;
  /** The chat is showing: polls only then */
  active: boolean;
}) {
  const enabled = useFlag("running");
  const { data } = useRunning(POLL_MS, enabled && active);
  const { stop, stopping } = useStopServer();
  if (!enabled) return null;
  const mine = (data ?? []).filter((s) => s.sessionId === session.id);
  if (!mine.length) return null;
  return (
    <div className="flex flex-col gap-2" aria-label="Running servers">
      {mine.map((s) => {
        const link =
          typeof window !== "undefined"
            ? new URL(s.url, window.location.href).toString()
            : s.url;
        return (
          <div
            key={s.port}
            className="bg-card flex flex-col gap-2.5 rounded-[20px] border border-emerald-400/30 px-3.5 py-3"
          >
            <div className="flex items-center gap-2 text-[13px]">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-emerald-400"
              />
              <span className="font-medium">Server running</span>
              {s.startedAt && (
                <span className="text-muted-foreground">
                  {shortAge(s.startedAt)}
                </span>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <MonitorPlay className="text-primary h-4 w-4 shrink-0" />
              <span className="font-mono text-[15px]">:{s.port}</span>
              <span className="text-muted-foreground min-w-0 truncate text-[13px]">
                {s.command || s.name}
              </span>
            </div>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary truncate font-mono text-[13px] underline underline-offset-2"
            >
              {link.replace(/^https?:\/\//, "")}
            </a>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  openPage({
                    kind: "running",
                    sessionId: session.id,
                    port: s.port,
                  })
                }
                className="bg-primary text-primary-foreground min-h-[44px] rounded-full px-4 text-[15px] font-medium"
              >
                Open preview
              </button>
              <button
                type="button"
                onClick={() => stop(s)}
                disabled={stopping === s.port}
                className="text-destructive min-h-[44px] rounded-full border border-red-400/35 bg-red-400/10 px-4 text-[15px] font-medium disabled:opacity-50"
              >
                {stopping === s.port ? "Stopping…" : "Stop"}
              </button>
            </div>
            <p className="text-muted-foreground text-[12px]">
              Reachable only by you, through AgentOS
            </p>
          </div>
        );
      })}
    </div>
  );
}
