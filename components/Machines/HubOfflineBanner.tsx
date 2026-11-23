"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { ServerOff, X } from "lucide-react";
import { useHubPeer, useTabMachineId } from "@/data/machines";
import { HUB_PEER_ID } from "@/lib/backup/share-types";
import { copiesSheetStore, openCopies } from "@/stores/copiesSheet";

/** The server has to be gone this long before the banner speaks */
const QUIET_MS = 20_000;

/**
 * Mounted once (Providers). In a linked machine's own window, while its
 * server is out of reach and this machine keeps copies of the server's
 * sessions: says so, and opens the copies to carry one on here
 */
export function HubOfflineBanner() {
  const tabMachine = useTabMachineId();
  const { data } = useHubPeer(5000);
  const { machineId: reading } = useSnapshot(copiesSheetStore);
  const [hidden, setHidden] = useState(false);

  if (tabMachine || !data?.machine || data.linked) return null;
  const copies = data.copies ?? 0;
  if (copies === 0 || (data.offlineMs ?? 0) < QUIET_MS) return null;
  if (hidden || reading) return null;

  const hubName = data.hubName ?? "The server";
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+10px)] z-[60] flex justify-center px-3"
    >
      <div className="bg-card border-border/70 pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border py-2 pr-2 pl-3 shadow-lg">
        <ServerOff
          aria-hidden
          className="text-muted-foreground h-5 w-5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">
            {hubName} is offline
          </p>
          <p className="text-muted-foreground text-[13px]">
            {copies === 1
              ? "1 of its sessions has a copy on this machine."
              : `${copies} of its sessions have a copy on this machine.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCopies(HUB_PEER_ID)}
          className="pill pill-primary shrink-0 active:opacity-80"
        >
          Carry on here
        </button>
        <button
          type="button"
          aria-label="Hide"
          onClick={() => setHidden(true)}
          className="text-muted-foreground grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-70"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
