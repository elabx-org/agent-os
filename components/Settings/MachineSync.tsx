"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { fetchOn } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import { ageText } from "@/lib/session-move-types";
import {
  revisionText,
  syncSummary,
  type MachineShare,
  type SyncRow,
  type SyncView,
} from "@/lib/backup/share-types";
import { cn } from "@/lib/utils";
import { Chevron } from "./SettingGroup";

const POLL_MS = 4000;

const LEVELS: { level: MachineShare["level"]; label: string }[] = [
  { level: "none", label: "Nothing" },
  { level: "some", label: "Just the projects I pick" },
  { level: "all", label: "Every project" },
];

function useSync(id: string, live: boolean) {
  const [view, setView] = useState<SyncView | null>(null);
  const load = useCallback(async () => {
    const res = await fetchOn(HUB_TARGET, `/api/machines/${id}/sync`).catch(
      () => null
    );
    if (res?.ok) setView((await res.json()) as SyncView);
  }, [id]);
  useEffect(() => {
    void load();
    if (!live) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, live]);
  return { view, setView, load };
}

/** "2 minutes ago", or what it is waiting for */
function whenText(row: SyncRow, online: boolean, machineName: string): string {
  if (row.state === "failed") {
    return row.syncedAt
      ? `Last synced ${ageText(Date.now() - row.syncedAt)} ago`
      : "Not copied yet";
  }
  if (row.state === "elsewhere") {
    return row.direction === "to"
      ? `Carried on by ${machineName} while this server was off`
      : "Carried on from this copy";
  }
  if (row.state === "waiting") {
    if (!online) return `Waiting for ${machineName} to come online`;
    return row.syncedAt
      ? `Changed since ${ageText(Date.now() - row.syncedAt)} ago, copying`
      : "Copying for the first time";
  }
  return `Synced ${ageText(Date.now() - (row.syncedAt ?? Date.now()))} ago`;
}

const STATE_TEXT: Record<SyncRow["state"], string> = {
  synced: "Up to date",
  waiting: "Syncing",
  failed: "Failed",
  elsewhere: "Continued",
};

function Tag({ state }: { state: SyncRow["state"] }) {
  return (
    <span
      className={cn(
        "bg-muted shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium",
        state === "synced" && "text-[var(--add)]",
        state === "failed" && "text-[var(--del)]",
        (state === "waiting" || state === "elsewhere") &&
          "text-muted-foreground"
      )}
    >
      {STATE_TEXT[state]}
    </span>
  );
}

function Rows({
  title,
  rows,
  view,
}: {
  title: string;
  rows: SyncRow[];
  view: SyncView;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-muted-foreground px-1 pb-1 text-[13px] font-medium">
        {title}
      </p>
      <div className="bg-card divide-border divide-y rounded-xl">
        {rows.map((row) => (
          <div
            key={`${row.direction}-${row.sessionId}`}
            className="flex items-start gap-3 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">
                {row.name}
                {row.projectName && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {row.projectName}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground block text-[13px]">
                {whenText(row, view.online, view.machineName)}
              </span>
              <span className="text-muted-foreground block text-[13px]">
                {revisionText(row)}
              </span>
              {row.error && (
                <span className="block text-[13px] text-[var(--del)]">
                  {row.error}
                </span>
              )}
            </div>
            <Tag state={row.state} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "Share this server's sessions with {name}", and the sync check: what is
 * shared, when each session was last the same on both sides, what the copy
 * holds, and when the next check is (lib/backup/hub-send.ts)
 */
export function MachineSyncRow({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { view, setView, load } = useSync(id, open);
  const [busy, setBusy] = useState(false);

  const send = async (method: "PUT" | "POST", body?: MachineShare) => {
    setBusy(true);
    const res = await fetchAsUser(`/api/machines/${id}/sync`, {
      method,
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    }).catch(() => null);
    if (res?.ok) setView((await res.json()) as SyncView);
    else {
      toast.error(
        res ? refusalText(await res.json().catch(() => ({}))) : "Couldn't save"
      );
      void load();
    }
    setBusy(false);
  };

  const share = view?.share ?? { level: "none", projects: [] };
  const to = view?.rows.filter((r) => r.direction === "to") ?? [];
  const from = view?.rows.filter((r) => r.direction === "from") ?? [];
  const line = !view
    ? "Checking…"
    : !view.supported
      ? `Starts once ${name} has updated itself.`
      : share.level === "none" && from.length === 0
        ? `Off: nothing from this server is copied to ${name}.`
        : syncSummary(view);
  const next =
    view?.nextCheckAt && view.nextCheckAt > Date.now()
      ? `in ${ageText(view.nextCheckAt - Date.now())}`
      : "soon";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="row w-full items-center gap-3 py-3 pl-[68px] text-left active:opacity-70"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px]">Sharing and sync</span>
          <span className="text-muted-foreground block text-[13px]">
            {line}
          </span>
        </span>
        <Chevron />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Sharing with {name}</SheetTitle>
            <SheetDescription>
              {name} keeps a copy of what you share: the conversation, the code
              and unsaved changes. If this server goes off, the copies are still
              on {name}.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-4 pb-4">
            {view && !view.supported && (
              <p className="text-muted-foreground text-[13px]">
                {name} needs to update itself before it can take copies. It does
                that by itself when it is online.
              </p>
            )}
            <div
              role="radiogroup"
              aria-label={`What to share with ${name}`}
              className="bg-card divide-border divide-y rounded-xl"
            >
              {LEVELS.map(({ level, label }) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={share.level === level}
                  disabled={busy || !view}
                  onClick={() =>
                    void send("PUT", { level, projects: share.projects })
                  }
                  className="flex w-full items-center gap-3 px-3 py-3 text-left text-[15px] active:opacity-70"
                >
                  <span className="min-w-0 flex-1">{label}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-5 place-items-center rounded-full border",
                      share.level === level
                        ? "border-primary"
                        : "border-muted-foreground/50"
                    )}
                  >
                    {share.level === level && (
                      <span className="bg-primary size-2.5 rounded-full" />
                    )}
                  </span>
                </button>
              ))}
            </div>
            {view && share.level === "some" && (
              <div>
                <p className="text-muted-foreground px-1 pb-1 text-[13px] font-medium">
                  Projects on both
                </p>
                <div className="bg-card divide-border divide-y rounded-xl">
                  {view.projects.length === 0 && (
                    <p className="text-muted-foreground px-3 py-3 text-[13px]">
                      No projects on this server yet.
                    </p>
                  )}
                  {view.projects.map((project) => {
                    const on = share.projects.includes(project.id);
                    return (
                      <button
                        key={project.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        disabled={busy}
                        onClick={() =>
                          void send("PUT", {
                            level: "some",
                            projects: on
                              ? share.projects.filter((p) => p !== project.id)
                              : [...share.projects, project.id],
                          })
                        }
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:opacity-70"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px]">
                            {project.name}
                          </span>
                          <span className="text-muted-foreground block text-[13px]">
                            {project.sessions === 1
                              ? "1 chat"
                              : `${project.sessions} chats`}
                          </span>
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "grid size-5 place-items-center rounded-md border text-[12px]",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/50"
                          )}
                        >
                          {on ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {view && (to.length > 0 || from.length > 0) && (
              <div className="bg-card rounded-xl px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="block text-[15px]">
                      {syncSummary(view)}
                    </span>
                    <span className="text-muted-foreground block text-[13px]">
                      {view.online
                        ? `Copies are made after each reply, with a full check every 5 minutes (next ${next}).`
                        : `${name} is offline. Copying starts again when it is back.`}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !view.online}
                    onClick={() => void send("POST")}
                    className="pill shrink-0 active:opacity-80 disabled:opacity-50"
                  >
                    Sync now
                  </button>
                </div>
              </div>
            )}
            {view && (
              <>
                <Rows
                  title={`On ${view.hubName}, copied to ${name}`}
                  rows={to}
                  view={view}
                />
                <Rows
                  title={`On ${name}, copied to ${view.hubName}`}
                  rows={from}
                  view={view}
                />
              </>
            )}
            <p className="text-muted-foreground text-[13px]">
              Never copied: your Claude sign-in, keys, and files git ignores
              such as .env.
            </p>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
