"use client";

import { useEffect, useMemo, useState } from "react";
import { StateDot } from "@/components/a/StateDot";
import { NeedsYouCard } from "@/components/Chat/NeedsYouCard";
import { openOnMachine } from "@/components/Machines/useOtherMachinesNow";
import type { PageProps } from "@/components/WorkspacePage/pages";
import {
  otherTargets,
  useHereName,
  useMachineSources,
  useMachines,
  useTabMachineId,
} from "@/data/machines";
import { useMacApp, useMacHereName } from "@/hooks/useMacHost";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { timeAgo } from "@/lib/agent-state";
import {
  allSummary,
  allTiles,
  filterTiles,
  tileCounts,
  type Tile,
  type TileFilter,
  type TileSource,
} from "@/lib/all-sessions";
import { cn } from "@/lib/utils";
import { setMacPageDetail } from "@/stores/macHost";

const DOT = { needs: "needs", working: "work", idle: "idle" } as const;
const WORD = { needs: "Needs you", working: "Working", idle: "Idle" } as const;

/**
 * All sessions: every session on this machine and the linked ones as live
 * tiles, the ones that need you first. A question is answered on its tile;
 * a tile from another machine opens there.
 */
export function AllSessionsPage({ view, onOpenSession }: PageProps<"all">) {
  const mac = useMacApp();
  const macName = useMacHereName();
  const plainName = useHereName();
  const hereName = (mac ? macName : plainName) ?? "This machine";

  const { data: machines } = useMachines();
  const mine = useTabMachineId();
  const tags = useMemo(() => otherTargets(machines, mine), [machines, mine]);
  const others = useMachineSources(tags);
  const titles = useListTitles(view.sessions);

  const tiles = useMemo(() => {
    const here: TileSource = {
      tag: null,
      sessions: view.sessions,
      statuses: view.sessionStatuses,
      projects: view.projects,
    };
    return allTiles([here, ...others]);
  }, [view.sessions, view.sessionStatuses, view.projects, others]);
  const counts = tileCounts(tiles);

  const [filter, setFilter] = useState<TileFilter>("all");
  // A machine that went offline takes its choice with it
  const [picked, setPicked] = useState<string | null>(null);
  const machine =
    picked !== null && tiles.some((t) => (t.tag?.target ?? "") === picked)
      ? picked
      : null;
  const shown = filterTiles(tiles, filter, machine);
  const summary = allSummary(counts.all, counts.machines);

  // The Mac window's toolbar says the same under its title
  useEffect(() => {
    setMacPageDetail(summary);
    return () => setMacPageDetail(null);
  }, [summary]);

  const open = (tile: Tile) =>
    tile.tag
      ? openOnMachine(tile.tag, { session: tile.session.id })
      : onOpenSession(tile.session);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-6 pt-5 pb-6">
      <header className="flex flex-none flex-wrap items-end gap-x-4 gap-y-3">
        <div className="mr-auto flex min-w-0 flex-col">
          <h1 className="t-large">All sessions</h1>
          <p className="text-muted-foreground text-[14px]">{summary}</p>
        </div>
        {counts.machines > 1 && (
          <label className="chip h-9 cursor-pointer gap-2 pr-2">
            <span className="sr-only">Machine</span>
            <select
              value={machine ?? "*"}
              onChange={(e) =>
                setPicked(e.target.value === "*" ? null : e.target.value)
              }
              className="cursor-pointer bg-transparent text-[14px] outline-0"
            >
              <option value="*">Every machine</option>
              <option value="">{hereName}</option>
              {others.map((source) => (
                <option key={source.tag.target} value={source.tag.target}>
                  {source.tag.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div
          role="group"
          aria-label="Show"
          className="seg bg-foreground/[0.06] flex-none"
        >
          {(
            [
              ["all", "Everything", 0],
              ["needs", "Needs you", counts.needs],
              ["working", "Working", counts.working],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              {count > 0 && (
                <span className="text-muted-foreground ml-1.5 font-mono text-[12px]">
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="text-muted-foreground flex flex-1 items-center justify-center text-[14px]">
          {counts.all === 0
            ? "No sessions yet. Start a chat and it shows here."
            : filter === "needs"
              ? "Nothing needs you."
              : filter === "working"
                ? "Nothing is working right now."
                : "No sessions on this machine."}
        </p>
      ) : (
        <ul className="grid flex-none grid-cols-[repeat(auto-fill,minmax(270px,1fr))] items-start gap-3">
          {shown.map((tile) => (
            <SessionTile
              key={tile.key}
              tile={tile}
              title={
                tile.tag
                  ? tile.session.name
                  : displayTitle(tile.session, titles).title
              }
              machine={
                counts.machines > 1 ? (tile.tag?.name ?? hereName) : null
              }
              onOpen={() => open(tile)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionTile({
  tile,
  title,
  machine,
  onOpen,
}: {
  tile: Tile;
  title: string;
  /** Named only when there is more than one machine */
  machine: string | null;
  onOpen: () => void;
}) {
  const { session, state, lines, tag } = tile;
  const where = [timeAgo(session.updated_at), tile.project]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      data-state={state}
      className={cn(
        "bg-card flex min-h-[132px] min-w-0 flex-col gap-2.5 rounded-[20px] p-3.5",
        state === "needs" && "ring-1 ring-[var(--needs-edge)]"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 items-center gap-2 text-left hover:underline"
      >
        <StateDot state={DOT[state]} />
        <span className="sr-only">{WORD[state]}:</span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {title}
        </span>
        {machine && (
          <span className="text-muted-foreground flex-none text-[12px]">
            {machine}
          </span>
        )}
      </button>

      {state === "needs" && !tag ? (
        // Answered here: the card is the same one the chat shows
        <NeedsYouCard
          session={session}
          variant="sheet"
          noHead
          onOpenTerminal={onOpen}
        />
      ) : (
        <div className="text-muted-foreground flex min-h-0 flex-1 flex-col justify-end gap-0.5 font-mono text-[12px] leading-[1.5]">
          {lines.length > 0 ? (
            lines.map((line, i) => (
              <span
                key={i}
                className={cn(
                  "truncate",
                  i === lines.length - 1 &&
                    state !== "idle" &&
                    "text-foreground"
                )}
              >
                {line}
              </span>
            ))
          ) : (
            <span className="font-sans text-[13px]">
              {state === "working" ? "Working…" : WORD[state]}
            </span>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-none items-center gap-2">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[12px]">
          {where}
        </span>
        {state === "needs" && tag && (
          <button
            type="button"
            onClick={onOpen}
            className="pill pill-secondary pill-sm flex-none active:opacity-80"
          >
            Answer on {tag.name}
          </button>
        )}
      </div>
    </li>
  );
}
