"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import type { MachineSetup } from "@/lib/claude-setup/hub";
import {
  countSentence,
  shortName,
  type SetupItem,
  type SetupKind,
  type SetupRow,
} from "@/lib/claude-setup/types";
import { cn } from "@/lib/utils";
import { Chevron } from "./SettingGroup";

const GROUPS: [SetupKind, string][] = [
  ["skill", "Skills"],
  ["plugin", "Plugins"],
  ["command", "Commands"],
  ["agent", "Agents"],
];

const setupKeyOf = (id: string) => ["claude-setup", id] as const;

async function readSetup(id: string): Promise<MachineSetup> {
  const res = await fetch(`/api/machines/${id}/claude-setup`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't check");
  return body as MachineSetup;
}

const toCopy = (row: SetupRow) =>
  row.state === "missing" || row.state === "update";

function sizeWord(bytes: number): string {
  if (bytes < 1024 * 1024) return "";
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** What goes under an item's name in the review list */
function itemNote(row: SetupRow, hubName: string): string {
  const { item } = row;
  const parts: string[] = [];
  if (item.usesTools) {
    parts.push(`Uses tools that may only be set up on ${hubName}`);
  } else if (item.kind === "plugin") {
    parts.push("Claude installs it there itself, from the same source");
  } else if (item.description) {
    parts.push(item.description);
  }
  if (row.state === "update") parts.push(`${hubName} has a newer one`);
  const size = sizeWord(item.bytes);
  if (size) parts.push(size);
  return parts.join(" · ");
}

/**
 * "Claude setup" under a linked machine (lib/claude-setup): what this
 * server has that the machine doesn't, a review list to copy from, and
 * "keep it matching". It only adds; what the machine already has stays
 */
export function ClaudeSetupRow({ id, name }: { id: string; name: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Keys the user unticked; null until the list is first shown */
  const [off, setOff] = useState<Set<string> | null>(null);
  const { data, error, isLoading } = useQuery({
    queryKey: setupKeyOf(id),
    queryFn: () => readSetup(id),
    staleTime: 5000,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.job?.state === "running" ? 2000 : false,
  });

  const pending = useMemo(() => data?.rows.filter(toCopy) ?? [], [data]);
  /** Edited on the machine; the server's is as it was */
  const edited = useMemo(
    () => data?.rows.filter((row) => row.state === "back") ?? [],
    [data]
  );
  /** Different on both: the user says which one wins, or leaves them */
  const kept = useMemo(
    () => data?.rows.filter((row) => row.state === "kept") ?? [],
    [data]
  );
  const [picks, setPicks] = useState<Record<string, "hub" | "machine">>({});

  // Starts from what was left out last time, plus anything that leans on
  // tools the machine may not have
  useEffect(() => {
    if (!data || off) return;
    setOff(
      new Set([
        ...data.skip,
        ...data.rows.filter((row) => row.item.usesTools).map((r) => r.item.key),
      ])
    );
  }, [data, off]);

  const send = async (body: object): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetchAsUser(`/api/machines/${id}/claude-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(refusalText(answer));
        return false;
      }
      client.setQueryData(setupKeyOf(id), answer as MachineSetup);
      return true;
    } catch {
      toast.error(`Couldn't reach ${name}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const chosen = pending.filter((row) => !off?.has(row.item.key));
  const sendBack = edited.filter((row) => !off?.has(row.item.key));
  const picked = kept.filter((row) => picks[row.item.key]);
  const changes = chosen.length + sendBack.length + picked.length;
  const copy = async () => {
    const keysOf = (rows: SetupRow[]) => rows.map((row) => row.item.key);
    const ok = await send({
      keys: keysOf(chosen),
      back: [
        ...keysOf(sendBack),
        ...keysOf(picked.filter((r) => picks[r.item.key] === "machine")),
      ],
      force: keysOf(picked.filter((r) => picks[r.item.key] === "hub")),
      skip: keysOf(
        [...pending, ...edited].filter((row) => off?.has(row.item.key))
      ),
    });
    if (ok) {
      setPicks({});
      toast.success(chosen.length === changes ? `Copying to ${name}` : "Done");
    }
  };

  const hubName = data?.hubName ?? "this server";
  const job = data?.job ?? null;
  const failedPlugins = job?.plugins.filter((p) => !p.ok) ?? [];
  const summary = isLoading
    ? "Checking…"
    : error
      ? (error as Error).message
      : !data
        ? ""
        : !data.claude
          ? `Claude isn't installed on ${name} yet.`
          : job?.state === "running"
            ? job.pluginsLeft > 0
              ? `Copying. ${job.pluginsLeft} ${job.pluginsLeft === 1 ? "plugin" : "plugins"} still to install.`
              : "Copying…"
            : pending.length
              ? `${hubName} has ${countSentence(pending.map((r) => r.item))} that ${name} doesn't.`
              : edited.length
                ? `${countSentence(edited.map((r) => r.item))} edited on ${name}, not yet on ${hubName}.`
                : kept.length
                  ? `${countSentence(kept.map((r) => r.item))} differ between ${name} and ${hubName}.`
                  : `${name} has everything ${hubName} has.`;

  const toggle = (key: string) =>
    setOff((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const followId = `machine-setup-follow-${id}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!data}
        className="row w-full items-center gap-3 py-3 pl-[68px] text-left active:opacity-70"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px]">Claude setup</span>
          <span className="text-muted-foreground block text-[13px]">
            {summary}
          </span>
        </span>
        {data && (
          <Chevron
            className={cn("transition-transform", open && "rotate-90")}
          />
        )}
      </button>
      {open && data && (
        <div className="space-y-3 pt-1 pr-4 pb-4 pl-[68px]">
          {job?.state === "failed" && (
            <p className="text-destructive text-[13px]">
              The last copy stopped: {job.error ?? "something went wrong"}
            </p>
          )}
          {failedPlugins.length > 0 && (
            <div className="text-[13px]">
              <p>
                {failedPlugins.length === 1
                  ? "1 plugin couldn't be installed"
                  : `${failedPlugins.length} plugins couldn't be installed`}{" "}
                on {name}. Install {failedPlugins.length === 1 ? "it" : "them"}{" "}
                there with /plugin in Claude.
              </p>
              <ul className="text-muted-foreground mt-1 space-y-0.5">
                {failedPlugins.map((p) => (
                  <li key={p.id} className="break-words">
                    {p.id.split("@")[0]}
                    {p.message ? `: ${p.message}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pending.length > 0 && (
            <>
              <p className="text-muted-foreground text-[13px]">
                Tick what to copy to {name}. Nothing {name} already has is
                changed or removed.
              </p>
              {GROUPS.map(([kind, title]) => {
                const rows = pending.filter((row) => row.item.kind === kind);
                if (!rows.length) return null;
                return (
                  <fieldset key={kind} className="min-w-0">
                    <legend className="text-muted-foreground pb-1 text-[13px] font-medium">
                      {title} ({rows.length})
                    </legend>
                    <ul className="divide-border divide-y">
                      {rows.map((row) => {
                        const note = itemNote(row, hubName);
                        const boxId = `setup-${id}-${row.item.key}`;
                        return (
                          <li key={row.item.key}>
                            <label
                              htmlFor={boxId}
                              className="flex min-h-11 items-start gap-3 py-2"
                            >
                              <input
                                id={boxId}
                                type="checkbox"
                                className="accent-primary mt-0.5 h-5 w-5 shrink-0"
                                checked={!off?.has(row.item.key)}
                                onChange={() => toggle(row.item.key)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[15px] break-words">
                                  {shortName(row.item)}
                                </span>
                                {note && (
                                  <span
                                    className={cn(
                                      "text-muted-foreground line-clamp-2 block text-[13px]"
                                    )}
                                  >
                                    {note}
                                  </span>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </>
          )}
          {edited.length > 0 && (
            <fieldset className="min-w-0">
              <legend className="text-muted-foreground pb-1 text-[13px] font-medium">
                Edited on {name} ({edited.length})
              </legend>
              <p className="text-muted-foreground pb-1 text-[13px]">
                Tick to send {name}&apos;s version to {hubName}. {hubName}
                &apos;s current one is kept in a backup folder.
              </p>
              <ul className="divide-border divide-y">
                {edited.map((row) => {
                  const boxId = `setup-back-${id}-${row.item.key}`;
                  return (
                    <li key={row.item.key}>
                      <label
                        htmlFor={boxId}
                        className="flex min-h-11 items-center gap-3 py-2"
                      >
                        <input
                          id={boxId}
                          type="checkbox"
                          className="accent-primary h-5 w-5 shrink-0"
                          checked={!off?.has(row.item.key)}
                          onChange={() => toggle(row.item.key)}
                        />
                        <span className="min-w-0 flex-1 text-[15px] break-words">
                          {shortName(row.item)} ({row.item.kind})
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          {kept.length > 0 && (
            <fieldset className="min-w-0">
              <legend className="text-muted-foreground pb-1 text-[13px] font-medium">
                Different on both ({kept.length})
              </legend>
              <p className="text-muted-foreground pb-1 text-[13px]">
                Nothing happens to these until you pick one. The version that is
                replaced is kept in a backup folder.
              </p>
              <ul className="divide-border divide-y">
                {kept.map((row) => {
                  const pick = picks[row.item.key] ?? "";
                  const label = `${shortName(row.item)} (${row.item.kind})`;
                  const choose = (value: "" | "hub" | "machine") =>
                    setPicks((prev) => {
                      const next = { ...prev };
                      if (value) next[row.item.key] = value;
                      else delete next[row.item.key];
                      return next;
                    });
                  const options: ["" | "hub" | "machine", string][] = [
                    ["", "Leave both"],
                    ["hub", `Use ${hubName}'s`],
                    ["machine", `Use ${name}'s`],
                  ];
                  return (
                    <li key={row.item.key} className="py-2">
                      <span className="block text-[15px] break-words">
                        {label}
                      </span>
                      <span
                        role="radiogroup"
                        aria-label={label}
                        className="mt-1.5 flex flex-wrap gap-1.5"
                      >
                        {options.map(([value, text]) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={pick === value}
                            onClick={() => choose(value)}
                            className={cn(
                              "min-h-9 rounded-full border px-3 text-[13px]",
                              pick === value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border text-muted-foreground"
                            )}
                          >
                            {text}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          {pending.length + edited.length + kept.length > 0 && (
            <button
              type="button"
              onClick={() => void copy()}
              disabled={busy || changes === 0 || job?.state === "running"}
              className="bg-primary text-primary-foreground min-h-11 w-full rounded-lg px-4 text-[15px] font-medium disabled:opacity-50"
            >
              {busy || job?.state === "running"
                ? "Working…"
                : changes === 0
                  ? "Nothing chosen"
                  : changes === chosen.length
                    ? `Copy ${changes} to ${name}`
                    : `Apply ${changes} ${changes === 1 ? "change" : "changes"}`}
            </button>
          )}
          <OwnList name={name} own={data.own} />
          <p className="text-muted-foreground text-[13px]">
            Never copied: your Claude sign-in, settings, and connections to
            other services or their keys. A chat already open on {name} may need
            restarting to see new plugins.
          </p>
          <div className="flex items-start gap-3">
            <label htmlFor={followId} className="min-w-0 flex-1">
              <span className="block text-[15px]">
                Keep it matching {hubName}
              </span>
              <span className="text-muted-foreground block text-[13px]">
                {data.follow
                  ? `Within about 10 minutes, what you add or change on ${hubName} is copied to ${name}, and a skill you edit on ${name} is sent back to ${hubName}. If both changed, nothing happens until you pick one. Anything you unticked stays out.`
                  : `Off: nothing is copied to ${name} unless you press Copy.`}
              </span>
            </label>
            <Switch
              id={followId}
              checked={data.follow}
              disabled={busy}
              onCheckedChange={(next) => void send({ follow: next })}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** What only the machine has: shown so it's clear it stays */
function OwnList({ name, own }: { name: string; own: SetupItem[] }) {
  if (!own.length) return null;
  return (
    <div className="text-[13px]">
      <p className="text-muted-foreground font-medium">
        Only on {name}, left alone ({own.length})
      </p>
      <p className="text-muted-foreground break-words">
        {own.map(shortName).join(", ")}
      </p>
    </div>
  );
}
