"use client";

import { Laptop, Server } from "lucide-react";
import type { Session } from "@/lib/db";
import { placeText } from "@/lib/backup/share-types";
import { ageText } from "@/lib/session-move-types";
import { usePlaces, useTabMachineId } from "@/data/machines";
import { openContinueSheet } from "@/stores/continueSheet";
import { useCanContinueElsewhere } from "./ContinueOnSheet";

/**
 * Above the composer of a session that has a copy on another machine
 * (Settings, Machines, Sharing and sync): where the copy is and how
 * fresh, and the way to work on it there. Nothing when it has no copy
 */
export function PlaceLine({ session }: { session: Session }) {
  const on = useTabMachineId();
  const { data } = usePlaces([session.id], on);
  const canGo = useCanContinueElsewhere(session);
  const place = data?.places[session.id]?.find((p) => p.state !== "elsewhere");
  if (!data || !place) return null;
  const Icon = place.kind === "server" ? Server : Laptop;
  const text = (
    <>
      <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <span className="min-w-0 flex-1 break-words">
        {data.here && (
          <span className="max-sm:hidden">Live on {data.here}. </span>
        )}
        {placeText(place, ageText)}
      </span>
    </>
  );
  const line = "text-muted-foreground flex items-start gap-2 text-[13px]";
  if (!canGo) {
    return (
      <p role="status" className={`${line} px-3 pb-1.5`}>
        {text}
      </p>
    );
  }
  return (
    <div className={`${line} px-3 pb-1.5`}>
      <p role="status" className="flex min-w-0 flex-1 items-start gap-2">
        {text}
      </p>
      <button
        type="button"
        onClick={() => openContinueSheet(session.id, session.name)}
        className="text-primary -my-1 flex-none py-1 font-semibold active:opacity-70"
      >
        Work on {place.name}
      </button>
    </div>
  );
}
