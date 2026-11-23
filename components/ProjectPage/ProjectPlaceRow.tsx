"use client";

import { Laptop } from "lucide-react";
import { ageText } from "@/lib/session-move-types";
import { useHereName, usePlaces, useTabMachineId } from "@/data/machines";
import type { AwayChats } from "./useProjectContinue";

/**
 * A project page's "Live on…" row: which machines the project's chats are
 * on, where their copies are and how fresh. Opens "Work on another
 * machine". Nothing while the project has no copy and no chat elsewhere,
 * or no chat here
 */
export function ProjectPlaceRow({
  ids,
  away,
  onOpen,
}: {
  /** The chats that live on this machine */
  ids: readonly string[];
  away: readonly AwayChats[];
  onOpen?: () => void;
}) {
  const on = useTabMachineId();
  const { data } = usePlaces(ids, on);
  const copies = Object.values(data?.places ?? {})
    .flat()
    .filter((p) => p.state !== "elsewhere");
  const hereName = useHereName();
  // With no chat here the rows below say it all: "2 chats are live on…"
  if (ids.length === 0 || (copies.length === 0 && away.length === 0)) {
    return null;
  }

  const names = [...new Set(copies.map((p) => p.name))];
  const newest = Math.max(0, ...copies.map((p) => p.syncedAt ?? 0));
  const failed = copies.filter((p) => p.state === "failed").length;
  const waiting = copies.filter((p) => p.state === "waiting").length;
  const here = data?.here || hereName || "this machine";
  const title =
    away.length > 0
      ? `Live on ${here} and ${away.map((g) => g.name).join(", ")}`
      : `Live on ${here}`;
  const detail =
    copies.length === 0
      ? `Its chats on ${here} have no copy on another machine.`
      : `${names.join(", ")} ${names.length === 1 ? "has" : "have"} a copy${
          newest ? `, synced ${ageText(Date.now() - newest)} ago` : ""
        }.`;
  const tag =
    copies.length === 0
      ? null
      : failed > 0
        ? `${failed} failed`
        : waiting > 0
          ? "Syncing"
          : "In sync";
  const body = (
    <>
      <Laptop aria-hidden className="text-muted-foreground h-5 w-5 flex-none" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">
          {title}
        </span>
        <span className="text-muted-foreground block text-[13px]">
          {detail}
        </span>
      </span>
      {tag && (
        <span
          className={
            failed > 0
              ? "flex-none rounded-full bg-red-500/15 px-2 py-0.5 text-[12px] font-semibold text-red-700 dark:text-red-300"
              : "bg-muted text-muted-foreground flex-none rounded-full px-2 py-0.5 text-[12px] font-semibold"
          }
        >
          {tag}
        </span>
      )}
    </>
  );
  const box = "bg-card flex w-full items-center gap-3 rounded-2xl px-4 py-2.5";
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className={`${box} text-left active:opacity-80`}
    >
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}
