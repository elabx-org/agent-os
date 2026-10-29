"use client";

import type { NotificationEntry } from "@/hooks/useNeedsYou";

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

/**
 * E-NeedsYou's "Earlier today": a group card of history rows, a 30px tile
 * (green check finished, amber ! asked) with the title and "project ·
 * answered · 3h". M1b U1b.2 implements it.
 */
export function HistoryCard(props: HistoryCardProps) {
  void props;
  return null;
}
