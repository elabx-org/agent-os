"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Laptop, MoreHorizontal, Pencil, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { confirmAction } from "@/components/ui/confirm";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  isOnline,
  machineKeys,
  useMachineActivity,
  useMachines,
  useSessionCount,
  useTabMachineId,
  type MachineView,
} from "@/data/machines";
import { activityLine, activitySummary } from "./machine-activity";
import { fetchAsUser, refusalText, reprove } from "@/lib/client/user-fetch";
import { AbilitiesRow } from "./AbilitiesRow";
import { fetchOn, switchMachine } from "@/lib/client/machine";
import {
  HUB_TARGET,
  inviteHasSignIn,
  shortCommand,
} from "@/lib/machine-marker";
import {
  DEFAULT_REPOS_DIR,
  REPOS_DIR_PREFERENCE_KEY,
  normalizeReposDir,
} from "@/lib/repos-dir";
import {
  SERVER_NAME_MAX,
  SERVER_NAME_PREFERENCE_KEY,
  normalizeServerName,
} from "@/lib/server-name";
import { cn } from "@/lib/utils";
import { Chevron } from "./SettingGroup";
import { ClaudeSetupRow } from "./ClaudeSetupRow";
import { MachineSyncRow } from "./MachineSync";
import { copiedWord, copyAge, sizeText } from "@/lib/backup/types";
import { openCopies } from "@/stores/copiesSheet";

/** Polled while this screen is open, to see a Mac arrive and connect */
const POLL_MS = 2000;

/** The section's grey heading above its card (.t-sec) */
function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="t-sec mt-5 mr-[var(--settings-gutter-r,20px)] mb-2 ml-[calc(var(--settings-gutter-l,20px)+4px)] first:mt-0">
      {children}
    </h3>
  );
}

function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group-card mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)]",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The 36px tile before a machine: a server or a laptop */
function Tile({ kind }: { kind: "server" | "mac" }) {
  const Icon = kind === "server" ? Server : Laptop;
  return (
    <span
      aria-hidden
      className="bg-foreground/[0.07] grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
    >
      <Icon className="text-muted-foreground h-[18px] w-[18px]" />
    </span>
  );
}

function Presence({ online, text }: { online: boolean; text: string }) {
  return (
    <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[14px]">
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          online ? "bg-work" : "bg-muted-foreground/50"
        )}
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

const sessionsWord = (n: number) => (n === 1 ? "1 session" : `${n} sessions`);

/**
 * Settings → Machines: this server and the machines linked to it, adding
 * a Mac in three steps, and the ones waiting for your approval. Shown when
 * the Labs flag is on (GET /api/machines says enabled).
 */
export function MachinesSection() {
  const { data } = useMachines(POLL_MS);
  const machineName = (id: string) =>
    data?.machines.find((m) => m.id === id)?.name ?? null;
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: machineKeys.list() }),
    [queryClient]
  );
  if (!data) return null;
  if (!data.enabled) {
    return (
      <p className="text-muted-foreground px-[calc(var(--settings-gutter-l,20px)+4px)] text-[14px]">
        Linked machines are off. Turn them on in Labs.
      </p>
    );
  }
  const linked = data.machines.filter((m) => m.status === "approved");
  const pending = data.machines.filter((m) => m.status === "pending");
  return (
    <div className="flex flex-col pb-4">
      <Heading>Linked</Heading>
      <Card>
        <ServerRow name={data.serverName ?? null} onChange={refresh} />
        {linked.map((m) => (
          <LinkedRow
            key={m.id}
            machine={m}
            machineName={machineName}
            onChange={refresh}
          />
        ))}
      </Card>
      {pending.length > 0 && (
        <>
          <Heading>Waiting for you</Heading>
          <div className="flex flex-col gap-3">
            {pending.map((m) => (
              <PendingCard key={m.id} machine={m} onChange={refresh} />
            ))}
          </div>
        </>
      )}
      <Heading>Add a Mac</Heading>
      <AddMac />
    </div>
  );
}

/** "This server": where AgentOS is open; tapping it comes back here */
function ServerRow({
  name,
  onChange,
}: {
  name: string | null;
  onChange: () => void;
}) {
  const tab = useTabMachineId();
  const { data: count } = useSessionCount(HUB_TARGET, true);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const online = count == null ? "Online" : `Online · ${sessionsWord(count)}`;

  const save = async () => {
    const next = normalizeServerName(draft);
    if (next === name) return setDraft(null);
    setSaving(true);
    // This server's own name, whichever machine the tab is on
    const res = await fetchOn(HUB_TARGET, "/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: SERVER_NAME_PREFERENCE_KEY, value: next }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      toast.error("Couldn't save the name");
      return;
    }
    setDraft(null);
    onChange();
  };

  if (draft !== null) {
    return (
      <form
        className="row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Tile kind="server" />
        <input
          autoFocus
          value={draft}
          maxLength={SERVER_NAME_MAX}
          placeholder="This server"
          aria-label="This server's name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(null);
            }
          }}
          className="bg-foreground/[0.07] min-w-0 flex-1 rounded-lg px-3 py-2 text-[16px] outline-none"
        />
        <button
          type="submit"
          disabled={saving}
          className="pill pill-primary pill-sm shrink-0 disabled:opacity-60"
        >
          Save
        </button>
      </form>
    );
  }

  return (
    <>
      <MachineRow
        kind="server"
        name={name ?? "This server"}
        online
        detail={name ? `This server · ${online}` : online}
        current={!tab}
        onOpen={() => switchMachine(null)}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${name ?? "This server"}: more`}
                className="text-muted-foreground active:bg-accent relative grid h-9 w-9 shrink-0 place-items-center rounded-full after:absolute after:-inset-1 after:content-['']"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDraft(name ?? "")}>
                <Pencil className="h-4 w-4" />
                {name ? "Rename" : "Give it a name"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <ReposFolderRow target={HUB_TARGET} name={name ?? "this server"} />
      <AbilitiesRow target={HUB_TARGET} name={name ?? "this server"} />
    </>
  );
}

function LinkedRow({
  machine,
  machineName,
  onChange,
}: {
  machine: MachineView;
  machineName: (id: string) => string | null;
  onChange: () => void;
}) {
  const tab = useTabMachineId();
  const online = isOnline(machine);
  const { data: count } = useSessionCount(machine.id, online);
  const [renaming, setRenaming] = useState(false);
  const copies = machine.copies ?? 0;
  const unconfirmed = machine.unconfirmed ?? 0;
  const detail = !online
    ? copies > 0
      ? `Offline · ${copiedWord(copies)}, newest ${copyAge(Date.now() - (machine.newestCopyAt ?? Date.now()))} ago`
      : "Offline"
    : machine.sameVersion === false
      ? "Online · needs the same AgentOS version"
      : count == null
        ? "Online"
        : `Online · ${sessionsWord(count)}`;

  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove ${machine.name}?`,
      message: [
        "It's cut off at once. Its sessions stay on it; link it again to see them here.",
        copies > 0 || unconfirmed > 0
          ? "The copies of its sessions kept here are deleted too."
          : "",
        unconfirmed > 0
          ? `${machine.name} was never told that ${unconfirmed} session(s) continued here; they may still be running on it.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetchAsUser(`/api/machines/${machine.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error(refusalText(await res.json().catch(() => ({}))));
      return;
    }
    onChange();
    if (machine.id === tab) switchMachine(null);
  };

  const deleteCopies = async () => {
    const ok = await confirmAction({
      title: `Delete the copies of ${machine.name}'s sessions?`,
      message: `Only the copies on this server go. The sessions on ${machine.name} stay as they are.`,
      confirmLabel: "Delete copies",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetchAsUser(`/api/machines/${machine.id}/backups`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error(refusalText(await res.json().catch(() => ({}))));
      return;
    }
    onChange();
  };

  const patch = async (
    change: { agents: boolean } | { usesHub: boolean } | { backup: boolean }
  ) => {
    const res = await fetchAsUser(`/api/machines/${machine.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    if (!res.ok) {
      toast.error(refusalText(await res.json().catch(() => ({}))));
      return;
    }
    onChange();
  };
  const allowAgents = (allowed: boolean) => patch({ agents: allowed });
  const allowUsesHub = async (allowed: boolean) => {
    // Turning it off needs no asking
    if (allowed) {
      const ok = await confirmAction({
        title: `Let sessions on ${machine.name} use this server?`,
        message: `Agents working on ${machine.name} will be able to read the conversations of sessions here, start new Claude sessions in your projects, send messages to sessions and stop them. A session they start asks you before it runs anything; once you approve, it runs here. They can also reach your other machines that have "Let sessions on this server use it" turned on. They can never answer a permission request, turn on full access or change these switches. You are told each time one starts a session here.`,
        confirmLabel: "Allow",
        cancelLabel: "Not now",
      });
      if (!ok) return;
    }
    await patch({ usesHub: allowed });
  };

  if (renaming) {
    return (
      <RenameRow
        machine={machine}
        onDone={() => {
          setRenaming(false);
          onChange();
        }}
      />
    );
  }

  return (
    <>
      <MachineRow
        kind="mac"
        name={machine.name}
        online={online}
        detail={detail}
        current={machine.id === tab}
        onOpen={online ? () => switchMachine(machine.id) : undefined}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${machine.name}: more`}
                className="text-muted-foreground active:bg-accent relative grid h-9 w-9 shrink-0 place-items-center rounded-full after:absolute after:-inset-1 after:content-['']"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil className="h-4 w-4" />
                Rename
              </DropdownMenuItem>
              {copies > 0 && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void deleteCopies()}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete its copies
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash2 className="h-4 w-4" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {machine.platform === "darwin" && (
        <div className="row py-3 pl-[68px]">
          <p className="text-muted-foreground min-w-0 flex-1 text-[13px]">
            To remove AgentOS from the Mac itself: on the Mac, open AgentOS in
            the menu bar and choose Uninstall AgentOS…, or run agent-os
            uninstall in Terminal. Remove here only cuts it off; AgentOS stays
            installed on the Mac.
          </p>
        </div>
      )}
      <AgentsRow
        name={machine.name}
        allowed={!!machine.agents}
        onChange={allowAgents}
      />
      <UsesHubRow
        machine={machine}
        needsUpdate={online && machine.up === false}
        onChange={allowUsesHub}
      />
      <BackupRow
        machine={machine}
        onSwitch={(on) => patch({ backup: on })}
        onDeleted={onChange}
      />
      <MachineSyncRow id={machine.id} name={machine.name} />
      <ActivityRow machine={machine} machineName={machineName} />
      {online && <ReposFolderRow target={machine.id} name={machine.name} />}
      {online && <AbilitiesRow target={machine.id} name={machine.name} />}
      {online && machine.sameVersion !== false && (
        <ClaudeSetupRow id={machine.id} name={machine.name} />
      )}
    </>
  );
}

/**
 * Whether sessions on this server may start and drive sessions on the
 * machine (AgentOS's tools). Off: only you, in the app, reach it
 */
function AgentsRow({
  name,
  allowed,
  onChange,
}: {
  name: string;
  allowed: boolean;
  onChange: (allowed: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const id = `machine-agents-${name}`;
  return (
    <div className="row items-start gap-3 py-3 pl-[68px]">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-[15px]">
          Let sessions on this server use it
        </span>
        <span className="text-muted-foreground block text-[13px]">
          {allowed
            ? `Agents here, and on your other machines you've let use this server, can start sessions on ${name} and give them work.`
            : `Off: only you can reach ${name}, from the app.`}
        </span>
      </label>
      <Switch
        id={id}
        checked={allowed}
        disabled={saving}
        onCheckedChange={async (next) => {
          setSaving(true);
          await onChange(next);
          setSaving(false);
        }}
      />
    </div>
  );
}

/**
 * Whether sessions on the machine may use this server: read its sessions,
 * start Claude sessions that ask first, message and stop them. A machine
 * on an older AgentOS can't ask at all until it updates
 */
function UsesHubRow({
  machine,
  needsUpdate,
  onChange,
}: {
  machine: MachineView;
  needsUpdate: boolean;
  onChange: (allowed: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const { name } = machine;
  const allowed = !!machine.usesHub;
  const id = `machine-uses-hub-${machine.id}`;
  return (
    <div className="row items-start gap-3 py-3 pl-[68px]">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-[15px]">
          Let sessions on {name} use this server
        </span>
        <span className="text-muted-foreground block text-[13px]">
          {needsUpdate
            ? `${name} needs to update first. It does this on its own shortly after it connects.`
            : allowed
              ? `Agents on ${name} can read the sessions here, start new Claude sessions in your projects, send them messages and stop them. What they start still asks you before it acts. They can't answer permission requests or turn on full access.`
              : `Off: sessions on ${name} can't see or touch anything here.`}
        </span>
      </label>
      <Switch
        id={id}
        checked={allowed}
        // An older machine can still be switched off
        disabled={saving || (needsUpdate && !allowed)}
        onCheckedChange={async (next) => {
          setSaving(true);
          await onChange(next);
          setSaving(false);
        }}
      />
    </div>
  );
}

/**
 * "Keep a copy of its sessions on this server" (lib/backup): the switch,
 * what is copied, and the way into the copies. Turning it off asks
 * whether the copies already here stay
 */
function BackupRow({
  machine,
  onSwitch,
  onDeleted,
}: {
  machine: MachineView;
  onSwitch: (on: boolean) => Promise<void>;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const { name } = machine;
  const on = !!machine.backup;
  const copies = machine.copies ?? 0;
  const unconfirmed = machine.unconfirmed ?? 0;
  const tooOld = on && machine.canTakeOver === false;
  const id = `machine-backup-${machine.id}`;

  const stop = async (drop: boolean) => {
    setAsking(false);
    setSaving(true);
    await onSwitch(false);
    if (drop) {
      const res = await fetchAsUser(`/api/machines/${machine.id}/backups`, {
        method: "DELETE",
      });
      if (!res.ok) toast.error(refusalText(await res.json().catch(() => ({}))));
      onDeleted();
    }
    setSaving(false);
  };

  return (
    <>
      <div className="row items-start gap-3 py-3 pl-[68px]">
        <label htmlFor={id} className="min-w-0 flex-1">
          <span className="block text-[15px]">
            Keep a copy of its sessions on this server
          </span>
          <span className="text-muted-foreground block text-[13px]">
            {!on
              ? `Off: nothing new from ${name} is copied here.`
              : tooOld
                ? `Starts once ${name} has updated itself.`
                : `After each reply, ${name} sends its Claude conversations and unfinished code here. If ${name} goes offline you can read them and carry on here. The copies stay on this server, where its sessions could read them.`}
          </span>
          {machine.copiesFull && (
            <span className="block text-[13px] text-[var(--del)]">
              Copies of {name} have reached 20 GB, so new changes aren&apos;t
              being copied. Delete copies you no longer need.
            </span>
          )}
          {unconfirmed > 0 && (
            <span className="block text-[13px] text-[var(--del)]">
              {name} hasn&apos;t confirmed it paused {unconfirmed} session(s)
              that continued here. Don&apos;t use those sessions on {name}.
            </span>
          )}
        </label>
        <Switch
          id={id}
          checked={on}
          disabled={saving}
          onCheckedChange={async (next) => {
            if (!next && copies > 0) {
              setAsking(true);
              return;
            }
            setSaving(true);
            await onSwitch(next);
            setSaving(false);
          }}
        />
      </div>
      {copies > 0 && (
        <button
          type="button"
          onClick={() => openCopies(machine.id)}
          className="row w-full items-center gap-3 py-3 pl-[68px] text-left active:opacity-70"
        >
          <span className="text-muted-foreground min-w-0 flex-1 text-[13px]">
            {copiedWord(copies)} · newest{" "}
            {copyAge(Date.now() - (machine.newestCopyAt ?? Date.now()))} ago ·{" "}
            {sizeText(machine.copyBytes ?? 0)}
          </span>
          <Chevron />
        </button>
      )}
      <Sheet open={asking} onOpenChange={setAsking}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Stop copying {name}&apos;s sessions?</SheetTitle>
            <SheetDescription>
              The {copies} copies already here stay until you delete them.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-2 pb-4">
            <button
              type="button"
              onClick={() => void stop(false)}
              className="pill pill-primary w-full active:opacity-80"
            >
              Stop and keep copies
            </button>
            <button
              type="button"
              onClick={() => void stop(true)}
              className="pill pill-secondary w-full text-[var(--del)] active:opacity-80"
            >
              Stop and delete copies
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="pill pill-secondary w-full active:opacity-80"
            >
              Cancel
            </button>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** "What {name}'s sessions did here": the row, and the list in a sheet */
function ActivityRow({
  machine,
  machineName,
}: {
  machine: MachineView;
  machineName: (id: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const { data: actions } = useMachineActivity(
    machine.id,
    open ? POLL_MS : undefined
  );
  if (!machine.usesHub && !actions?.length) return null;
  const { name } = machine;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="row w-full items-center gap-3 py-3 pl-[68px] text-left active:opacity-70"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px]">
            What {name}&apos;s sessions did here
          </span>
          <span className="text-muted-foreground block text-[13px]">
            {activitySummary(actions ?? [])}
          </span>
        </span>
        <Chevron />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>What {name}&apos;s sessions did here</SheetTitle>
            <SheetDescription>Kept for 30 days.</SheetDescription>
          </SheetHeader>
          <SheetBody className="pb-4">
            {!actions?.length ? (
              <p className="text-muted-foreground px-1 text-[15px]">
                Nothing yet. When a session on {name} starts or messages a
                session here, it shows in this list.
              </p>
            ) : (
              <ul className="flex flex-col gap-3 px-1">
                {actions.map((action) => {
                  const line = activityLine(action, machineName);
                  return (
                    <li key={action.id} className="min-w-0">
                      <span className="block text-[15px]">
                        {line.text}
                        <span className="text-muted-foreground">
                          {" · "}
                          {new Date(action.at).toLocaleString()}
                        </span>
                      </span>
                      {line.detail && (
                        <span className="text-muted-foreground line-clamp-2 block text-[13px] break-words">
                          {line.detail}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** One machine on the Linked card; tapping it opens the app there */
function MachineRow({
  kind,
  name,
  online,
  detail,
  current,
  onOpen,
  menu,
}: {
  kind: "server" | "mac";
  name: string;
  online: boolean;
  detail: string;
  current: boolean;
  onOpen?: () => void;
  menu?: ReactNode;
}) {
  const body = (
    <>
      <Tile kind={kind} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[16px] font-medium">{name}</span>
        <Presence online={online} text={detail} />
      </span>
      {current ? (
        <span className="text-muted-foreground shrink-0 text-[13px]">
          Viewing
        </span>
      ) : (
        onOpen && <Chevron />
      )}
    </>
  );
  return (
    <div className="row gap-2 pr-2">
      {onOpen && !current ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open AgentOS on ${name}`}
          className="flex min-w-0 flex-1 items-center gap-3 active:opacity-70"
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {menu}
    </div>
  );
}

/**
 * The folder a machine keeps repositories in: a session that continues
 * there looks for its repository in it, and clones it there otherwise
 */
function ReposFolderRow({ target, name }: { target: string; name: string }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const path = `/api/preferences?key=${REPOS_DIR_PREFERENCE_KEY}`;
  useEffect(() => {
    let gone = false;
    fetchOn(target, path)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { value?: unknown } | null) => {
        if (gone || !body) return;
        setFolder(normalizeReposDir(body.value) ?? DEFAULT_REPOS_DIR);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [target, path]);
  if (folder === null) return null;

  const save = async () => {
    const next = normalizeReposDir(draft);
    if (!next) {
      toast.error("Give a full path, like ~/code or /srv/code");
      return;
    }
    if (next === folder) return setDraft(null);
    setSaving(true);
    const send = () =>
      fetchOn(target, "/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: REPOS_DIR_PREFERENCE_KEY, value: next }),
      });
    let res = await send();
    if (res.status === 403) {
      await reprove();
      res = await send();
    }
    setSaving(false);
    if (!res.ok) {
      toast.error(refusalText(await res.json().catch(() => ({}))));
      return;
    }
    setFolder(next);
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <form
        className="row gap-2 py-3 pl-[68px]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          autoFocus
          value={draft}
          maxLength={1024}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`Repositories folder on ${name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(null);
            }
          }}
          className="bg-foreground/[0.07] min-w-0 flex-1 rounded-lg px-3 py-2 font-mono text-[15px] outline-none"
        />
        <button
          type="submit"
          disabled={saving}
          className="pill pill-primary pill-sm shrink-0 disabled:opacity-60"
        >
          Save
        </button>
      </form>
    );
  }
  return (
    <div className="row items-start gap-3 py-3 pl-[68px]">
      <div className="min-w-0 flex-1">
        <span className="block text-[15px]">Repositories folder</span>
        <span className="block font-mono text-[13px] break-all">{folder}</span>
        <span className="text-muted-foreground block text-[13px]">
          A session that continues on {name} uses its repository from here, or
          clones it here.
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDraft(folder)}
        className="pill pill-sm shrink-0"
      >
        Change
      </button>
    </div>
  );
}

function RenameRow({
  machine,
  onDone,
}: {
  machine: MachineView;
  onDone: () => void;
}) {
  const [name, setName] = useState(machine.name);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const next = name.trim();
    if (!next || next === machine.name) return onDone();
    setSaving(true);
    const res = await fetchAsUser(`/api/machines/${machine.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(refusalText(await res.json().catch(() => ({}))));
      return;
    }
    onDone();
  };
  return (
    <form
      className="row gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Tile kind="mac" />
      <input
        autoFocus
        value={name}
        maxLength={60}
        aria-label="Machine name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone();
          }
        }}
        className="bg-foreground/[0.07] min-w-0 flex-1 rounded-lg px-3 py-2 text-[16px] outline-none"
      />
      <button
        type="submit"
        disabled={saving}
        className="pill pill-primary pill-sm shrink-0 disabled:opacity-60"
      >
        Save
      </button>
    </form>
  );
}

/** A Mac that wants to join: its name, the code to match, Approve or Decline */
function PendingCard({
  machine,
  onChange,
}: {
  machine: MachineView;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const act = async (kind: "approve" | "decline") => {
    setBusy(kind);
    const res = await fetchAsUser(
      `/api/machines/${machine.id}`,
      kind === "approve"
        ? {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approve: true }),
          }
        : { method: "DELETE" }
    );
    setBusy(null);
    if (!res.ok) {
      toast.error(refusalText(await res.json().catch(() => ({}))));
      return;
    }
    onChange();
  };
  const details = [
    machine.signedInAs ? `signed in as ${machine.signedInAs}` : null,
    machine.presence === "offline" ? "not connected" : null,
  ].filter(Boolean);
  return (
    <Card className="flex flex-col gap-3.5 p-3.5">
      <div className="flex items-center gap-3">
        <Tile kind="mac" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-medium">
            {machine.name} wants to join
          </span>
          <span className="text-muted-foreground block truncate text-[14px]">
            Code{" "}
            <span className="text-foreground/90 font-semibold tracking-wider tabular-nums">
              {machine.code ?? "…"}
            </span>
            {details.length > 0 && ` · ${details.join(" · ")}`}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("approve")}
          className="pill pill-primary w-full active:opacity-80 disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("decline")}
          className="pill pill-secondary w-full active:opacity-80 disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </Card>
  );
}

interface Pairing {
  code: string;
  expiresAt: number;
  command: string;
}

/** Minutes left, in words */
function expiresIn(expiresAt: number, now: number): string | null {
  const left = Math.ceil((expiresAt - now) / 60000);
  if (left <= 0) return null;
  return left === 1 ? "Works for 1 more minute" : `Works for ${left} minutes`;
}

/**
 * The three steps. The one-time command is only made when asked for ("Get
 * the command": POST /api/machines/pair, the user's own call), and again
 * on "New command" once it runs out. Nothing is made by opening Settings.
 */
function AddMac() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const ask = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAsUser("/api/machines/pair", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusalText(body));
      setPairing(body as Pairing);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a command");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const left = pairing ? expiresIn(pairing.expiresAt, now) : null;
  const expired = !!pairing && !left;
  const signIn = pairing ? inviteHasSignIn(pairing.command) : null;

  const copy = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Press and hold the command to copy it");
    }
  };

  return (
    <Card>
      <Step n={1} title="On the Mac, paste this into Terminal">
        {error ? (
          <p className="mt-2 text-[14px] text-red-500">{error}</p>
        ) : !pairing ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void ask()}
            className="pill pill-secondary pill-sm mt-2.5 active:opacity-80 disabled:opacity-60"
          >
            {loading ? "Making a command…" : "Get the command"}
          </button>
        ) : (
          <div
            className={cn(
              "bg-background mt-2.5 flex min-h-11 items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-3.5",
              expired && "opacity-50"
            )}
          >
            <code
              className="min-w-0 flex-1 truncate font-mono text-[13px] select-all"
              title={pairing?.command}
            >
              {pairing ? shortCommand(pairing.command) : "…"}
            </code>
            <button
              type="button"
              disabled={!pairing || expired}
              onClick={copy}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[15px] font-medium text-violet-700 active:opacity-70 disabled:opacity-40 dark:text-violet-300"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        <p className="text-muted-foreground mt-2 flex items-center gap-2 text-[13px]">
          <span>
            {!pairing && !error
              ? "It works once, for 10 minutes"
              : loading
                ? "Making a command…"
                : expired
                  ? "This command has run out"
                  : (left ?? "")}
          </span>
          {(expired || error || (pairing && !loading)) && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void ask()}
              className="font-medium text-violet-700 active:opacity-70 dark:text-violet-300"
            >
              New command
            </button>
          )}
        </p>
      </Step>
      {signIn === false ? (
        <Step
          n={2}
          title="Leave Terminal open"
          sub="The Mac connects on its own"
        />
      ) : (
        <Step
          n={2}
          title="Sign in when the browser opens"
          sub="Your usual login and second factor"
        />
      )}
      <Step
        n={3}
        title="Approve it here"
        sub="Check the code matches the one on the Mac"
      />
    </Card>
  );
}

function Step({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="row items-start gap-3">
      <span
        aria-hidden
        className="mt-px grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-violet-500/20 text-[13px] font-semibold text-violet-700 dark:text-violet-300"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px]">{title}</p>
        {sub && <p className="text-muted-foreground text-[14px]">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

/** Settings' row value: "2 linked", "1 waiting" */
export function machinesSummary(machines: MachineView[]): string | undefined {
  const waiting = machines.filter((m) => m.status === "pending").length;
  if (waiting) return `${waiting} waiting`;
  const linked = machines.length;
  return linked ? `${linked} linked` : undefined;
}
