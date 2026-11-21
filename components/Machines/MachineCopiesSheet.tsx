"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { ChevronLeft } from "lucide-react";
import { serverNameOr } from "@/lib/server-name";
import { isOnline, useMachineCopies, useMachines } from "@/data/machines";
import { copyAge } from "@/lib/backup/types";
import { closeCopies, copiesSheetStore, openCopy } from "@/stores/copiesSheet";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { CopyViewer } from "./CopyViewer";
import { TakeOverSheet } from "./TakeOverSheet";

/**
 * "Copies from {name}": the copies of a linked machine's sessions kept on
 * this server, one to read, and continuing one here. Mounted once
 * (Providers); copiesSheetStore opens it
 */
export function MachineCopiesSheetHost() {
  const { machineId, sessionId } = useSnapshot(copiesSheetStore);
  const open = !!machineId;
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeCopies()}>
      <SheetContent className="sheet-surface flex max-h-[92dvh] flex-col bg-[var(--sheet)] pb-[max(16px,env(safe-area-inset-bottom))]">
        <SheetDescription className="sr-only">
          Copies of a linked machine&apos;s sessions kept on this server
        </SheetDescription>
        {machineId ? (
          <Body key={machineId} machineId={machineId} sessionId={sessionId} />
        ) : (
          <SheetTitle className="sr-only">Copies</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  machineId,
  sessionId,
}: {
  machineId: string;
  sessionId: string | null;
}) {
  const { data: machines } = useMachines(5000);
  const { data } = useMachineCopies(machineId, 5000);
  const [taking, setTaking] = useState(false);
  const machine = machines?.machines.find((m) => m.id === machineId);
  const name = machine?.name ?? "that machine";
  const hubName = serverNameOr(machines?.serverName);
  const copies = data?.copies ?? [];
  const copy = sessionId
    ? copies.find((c) => c.sessionId === sessionId)
    : undefined;

  if (copy && taking) {
    return (
      <TakeOverSheet
        machineId={machineId}
        machineName={name}
        hubName={hubName}
        copy={copy}
        onCancel={() => setTaking(false)}
        onDone={closeCopies}
      />
    );
  }

  if (copy) {
    return (
      <>
        <SheetTitle className="sr-only">Copy from {name}</SheetTitle>
        <button
          type="button"
          onClick={() => openCopy(null)}
          className="text-muted-foreground flex items-center gap-1 px-3 text-[15px] active:opacity-70"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
          Copies from {name}
        </button>
        <CopyViewer
          machineId={machineId}
          machineName={name}
          hubName={hubName}
          copy={copy}
          onContinue={() => setTaking(true)}
        />
      </>
    );
  }

  const online = !!machine && isOnline(machine);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1">
      <div className="min-w-0">
        <SheetTitle className="t-title text-[20px] leading-tight font-bold tracking-normal">
          Copies from {name}
        </SheetTitle>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {online
            ? `${name} is online. Open it to use these sessions.`
            : `${name} is offline. These are as it last sent them.`}
        </p>
      </div>
      {copies.length === 0 ? (
        <p className="text-muted-foreground px-1 text-[15px]">
          No copies yet. One is made after each reply.
        </p>
      ) : (
        <ul className="bg-card divide-border/60 divide-y overflow-hidden rounded-2xl">
          {copies.map((c) => (
            <li key={c.sessionId}>
              <button
                type="button"
                onClick={() => openCopy(c.sessionId)}
                className="flex min-h-[56px] w-full flex-col justify-center px-4 py-2 text-left active:opacity-80"
              >
                <span className="block truncate text-[16px]">{c.name}</span>
                <span className="text-muted-foreground block truncate text-[13px]">
                  {c.projectName ? `${c.projectName} · ` : ""}copied{" "}
                  {copyAge(Date.now() - c.copiedAt)} ago
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
