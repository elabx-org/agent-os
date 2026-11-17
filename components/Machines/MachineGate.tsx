"use client";

import { useEffect, useState } from "react";
import { Laptop } from "lucide-react";
import { useMachines, useTabMachineId } from "@/data/machines";
import { MACHINE_GONE_EVENT, switchMachine } from "@/lib/client/machine";
import { openPage } from "@/stores/workspacePage";

/**
 * Mounted once (Providers). On a machine that has gone offline or been
 * removed, the app behind can't work: a clear page over it with the way
 * back to this server. Also opens the project a switch named (?project=).
 */
export function MachineGate() {
  useProjectLink();
  const id = useTabMachineId();
  if (!id) return null;
  return <Gate id={id} />;
}

function Gate({ id }: { id: string }) {
  const { data, refetch } = useMachines(3000);
  const [checking, setChecking] = useState(false);
  const retry = async () => {
    setChecking(true);
    await refetch();
    setChecking(false);
  };

  // A call that came back "no such machine" or "offline": check at once
  useEffect(() => {
    const onGone = () => void refetch();
    window.addEventListener(MACHINE_GONE_EVENT, onGone);
    return () => window.removeEventListener(MACHINE_GONE_EVENT, onGone);
  }, [refetch]);

  if (!data) return null;
  const machine = data.enabled
    ? data.machines.find((m) => m.id === id && m.status === "approved")
    : undefined;
  if (machine?.presence === "online") return null;

  const name = machine?.name ?? "This Mac";
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="machine-gate-title"
      className="bg-background/95 fixed inset-0 z-[70] flex items-center justify-center px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <span className="bg-card grid h-14 w-14 place-items-center rounded-2xl">
          <Laptop aria-hidden className="text-muted-foreground h-7 w-7" />
        </span>
        <h1 id="machine-gate-title" className="t-title">
          {machine ? `${name} is offline` : `${name} isn't linked any more`}
        </h1>
        <p className="text-muted-foreground text-[15px]">
          {machine
            ? "Its sessions are still there. They'll show here again once it's back online."
            : "It was removed from Machines, or Linked machines was turned off."}
        </p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={() => switchMachine(null)}
            className="pill pill-primary w-full active:opacity-80"
          >
            Back to this server
          </button>
          {machine && (
            <button
              type="button"
              disabled={checking}
              onClick={() => void retry()}
              className="pill pill-secondary w-full active:opacity-80 disabled:opacity-60"
            >
              {checking ? "Checking…" : "Try again"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** "?project=<id>" from a switch: that project's page, once */
function useProjectLink() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const projectId = url.searchParams.get("project");
    if (!projectId) return;
    url.searchParams.delete("project");
    window.history.replaceState(null, "", url);
    openPage({ kind: "project", projectId });
  }, []);
}
