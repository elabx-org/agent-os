"use client";

import { Bell, Check, CircleAlert, type LucideIcon } from "lucide-react";
import { GroupCard, GroupRow } from "@/components/a/GroupCard";
import { SectionTitle } from "@/components/a/SectionTitle";
import type { NotificationEntry } from "@/hooks/useNeedsYou";
import { cn } from "@/lib/utils";
import {
  historySubline,
  historyTile,
  historyTitle,
  type HistoryTile,
} from "./history-rows";

export interface HistoryCardProps {
  /** The section title above the card ("Finished", "Earlier today") */
  title: string;
  entries: NotificationEntry[];
  /**
   * What tapping a row opens; undefined for an entry whose session or
   * agent is gone (the row is then plain text)
   */
  openFor: (entry: NotificationEntry) => (() => void) | undefined;
  /** The entry showing beside the list (open Duo), as .row.sel */
  selectedId?: string;
}

// The mock's .sq tiles: a 16% wash of the state's colour
const TILE: Record<HistoryTile, { icon: LucideIcon; className: string }> = {
  done: { icon: Check, className: "bg-work/16 text-work" },
  needs: { icon: CircleAlert, className: "bg-needs/16 text-needs" },
  bell: { icon: Bell, className: "bg-foreground/8 text-muted-foreground" },
};

function Tile({ tile }: { tile: HistoryTile }) {
  const { icon: Icon, className } = TILE[tile];
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-[30px] w-[30px] flex-none place-items-center rounded-lg",
        className
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={tile === "done" ? 2.6 : 2} />
    </span>
  );
}

/**
 * E-NeedsYou's "Earlier today": a group card of history rows, a 30px tile
 * (green check finished, amber ! asked) with the title and "project ·
 * answered · 3h"
 */
export function HistoryCard({
  title,
  entries,
  openFor,
  selectedId,
}: HistoryCardProps) {
  if (!entries.length) return null;
  return (
    <section className="flex shrink-0 flex-col gap-3">
      <SectionTitle className="mt-1">{title}</SectionTitle>
      <GroupCard aria-label={title}>
        {entries.map((entry) => {
          const open = openFor(entry);
          return (
            <GroupRow
              key={entry.id}
              leading={<Tile tile={historyTile(entry)} />}
              title={historyTitle(entry)}
              // Still there and not waiting: the prompt was dealt with
              subtitle={historySubline(entry, { answered: !!open })}
              selected={entry.id === selectedId}
              compact
              onClick={open}
            />
          );
        })}
      </GroupCard>
    </section>
  );
}
