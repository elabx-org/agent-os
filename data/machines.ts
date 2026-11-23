"use client";

import { useSyncExternalStore } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Session } from "@/lib/db";
import type { MachineAction } from "@/lib/link/machine-actions";
import { fetchOn, tabMachine } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import { serverNameOr } from "@/lib/server-name";
import type { PlaceView } from "@/lib/backup/share-types";
import type { Abilities, AbilitiesView } from "@/lib/abilities-types";
import type { AgentLike, MachineSource, MachineTag } from "@/lib/machine-now";
import type { SessionStatus } from "@/components/views/types";
import type { ProjectWithRepositories } from "@/lib/projects";
import type { BackupView, TakeJob } from "@/lib/backup/types";

/** GET /api/machines (app/api/machines/route.ts) */
export interface MachineView {
  id: string;
  name: string;
  status: "pending" | "approved";
  presence: "online" | "offline" | "waiting";
  platform: string | null;
  code: string | null;
  signedInAs: string | null;
  createdAt: number;
  lastSeen: number | null;
  sameVersion: boolean | null;
  /** Sessions on this server may use it through AgentOS's tools */
  agents?: boolean;
  /** Its sessions may use this server (lib/link/up.ts) */
  usesHub?: boolean;
  /** It can ask this server at all (its version); null while offline */
  up?: boolean | null;
  /** Copies of its sessions are kept here (lib/backup) */
  backup?: boolean;
  copies?: number;
  newestCopyAt?: number | null;
  copyBytes?: number;
  /** Its copies reached the 20 GB cap: new changes aren't copied */
  copiesFull?: boolean;
  /** Sessions continued here it hasn't confirmed pausing */
  unconfirmed?: number;
  /** Its version can pause what was continued here (caps take1) */
  canTakeOver?: boolean;
}

export interface MachinesResponse {
  enabled: boolean;
  machines: MachineView[];
  /** The user's name for this server; null or absent when it has none */
  serverName?: string | null;
}

export const machineKeys = {
  all: ["machines"] as const,
  list: () => [...machineKeys.all, "list"] as const,
  on: (target: string, what: string) =>
    [...machineKeys.all, "on", target, what] as const,
  activity: (id: string) => [...machineKeys.all, "activity", id] as const,
  copies: (id: string) => [...machineKeys.all, "copies", id] as const,
  take: (id: string) => [...machineKeys.all, "take", id] as const,
};

async function fetchMachines(): Promise<MachinesResponse> {
  // Always this server's own list, whichever machine the tab is on
  const res = await fetchOn(HUB_TARGET, "/api/machines");
  if (!res.ok) throw new Error("Failed to load machines");
  return res.json();
}

/**
 * The linked machines. Off (the Labs flag), one read per page load and no
 * more; on, refreshed every `pollMs` while a screen asks for it
 */
export function useMachines(pollMs?: number) {
  return useQuery({
    queryKey: machineKeys.list(),
    queryFn: fetchMachines,
    staleTime: (query) =>
      query.state.data?.enabled === false ? Infinity : 5000,
    refetchInterval: (query) =>
      pollMs && query.state.data?.enabled ? pollMs : false,
  });
}

/** Approved and connected: its lists can be read */
export const isOnline = (m: MachineView) =>
  m.status === "approved" && m.presence === "online";

const never = () => () => {};
const onServer = () => null;

/**
 * The tab's machine id; null on this server, and while hydrating (the
 * server's render has no tab). It only changes with a reload.
 */
export function useTabMachineId(): string | null {
  return useSyncExternalStore(never, tabMachine, onServer);
}

/** What the machine this tab looks at is called, null until it is known */
export function useHereName(): string | null {
  const id = useTabMachineId();
  const { data } = useMachines();
  if (!data) return null;
  if (id) return data.machines.find((m) => m.id === id)?.name ?? null;
  return serverNameOr(data.serverName, "this server");
}

/** The tab's machine, with its name and state from the list */
export function useTabMachine(): {
  id: string | null;
  machine: MachineView | null;
  data: MachinesResponse | undefined;
} {
  const id = useTabMachineId();
  const { data } = useMachines();
  return {
    id,
    machine: data?.machines.find((m) => m.id === id) ?? null,
    data,
  };
}

/** Where else to read Now's lists: the other online machines, and this
    server when the tab is on a machine */
export function otherTargets(
  data: MachinesResponse | undefined,
  mine: string | null
): MachineTag[] {
  if (!data?.enabled) return [];
  const tags: MachineTag[] = data.machines
    .filter((m) => isOnline(m) && m.id !== mine)
    .map((m) => ({ target: m.id, name: m.name, kind: "mac" }));
  if (mine)
    tags.unshift({ target: HUB_TARGET, name: "Server", kind: "server" });
  return tags;
}

async function readJson<T>(target: string, path: string): Promise<T> {
  const res = await fetchOn(target, path);
  if (!res.ok) throw new Error(`Failed to read ${path}`);
  return res.json();
}

const LISTS_MS = 15000;
const STATUS_MS = 5000;
/** Each read may start the CLI on that machine */
const AGENTS_MS = 30000;
/** Reads per machine in useMachineSources */
const PER_TAG = 4;

/**
 * Sessions, statuses and projects on each of `tags`: Now's rows from the
 * other machines. Nothing at all while there are none.
 */
export function useMachineSources(tags: MachineTag[]): MachineSource[] {
  const queries = useQueries({
    queries: tags.flatMap((tag) => [
      {
        queryKey: machineKeys.on(tag.target, "sessions"),
        queryFn: () =>
          readJson<{ sessions?: Session[] }>(tag.target, "/api/sessions"),
        refetchInterval: LISTS_MS,
        staleTime: LISTS_MS / 2,
      },
      {
        queryKey: machineKeys.on(tag.target, "statuses"),
        queryFn: () =>
          readJson<{ statuses?: Record<string, SessionStatus> }>(
            tag.target,
            "/api/sessions/status"
          ),
        refetchInterval: STATUS_MS,
        staleTime: STATUS_MS / 2,
      },
      {
        queryKey: machineKeys.on(tag.target, "projects"),
        queryFn: () =>
          readJson<{ projects?: ProjectWithRepositories[] }>(
            tag.target,
            "/api/projects"
          ),
        refetchInterval: LISTS_MS * 2,
        staleTime: LISTS_MS,
      },
      {
        queryKey: machineKeys.on(tag.target, "agents"),
        queryFn: () =>
          readJson<{ agents?: AgentLike[] }>(
            tag.target,
            "/api/background-agents"
          ),
        refetchInterval: AGENTS_MS,
        staleTime: AGENTS_MS / 2,
      },
    ]),
  });
  return tags.flatMap((tag, i) => {
    const sessions = queries[i * PER_TAG].data as
      | { sessions?: Session[] }
      | undefined;
    const statuses = queries[i * PER_TAG + 1].data as
      | { statuses?: Record<string, SessionStatus> }
      | undefined;
    const projects = queries[i * PER_TAG + 2].data as
      | { projects?: ProjectWithRepositories[] }
      | undefined;
    const agents = queries[i * PER_TAG + 3].data as
      | { agents?: AgentLike[] }
      | undefined;
    // Shown once its sessions are in; the rest fill in
    if (!sessions?.sessions) return [];
    return [
      {
        tag,
        sessions: sessions.sessions,
        statuses: statuses?.statuses ?? {},
        projects: projects?.projects ?? [],
        agents: agents?.agents ?? [],
      },
    ];
  });
}

/** How many sessions a machine (or this server) has, for Settings */
export function useSessionCount(target: string, enabled: boolean) {
  return useQuery({
    queryKey: machineKeys.on(target, "sessions"),
    queryFn: () => readJson<{ sessions?: Session[] }>(target, "/api/sessions"),
    enabled,
    staleTime: LISTS_MS / 2,
    refetchInterval: enabled ? LISTS_MS : false,
    select: (data) => data.sessions?.length ?? 0,
  });
}

/** What a machine's sessions did on this server (Settings, Machines) */
export function useMachineActivity(id: string, pollMs?: number) {
  return useQuery({
    queryKey: machineKeys.activity(id),
    queryFn: () =>
      readJson<{ actions: MachineAction[] }>(
        HUB_TARGET,
        `/api/machines/${id}/activity?limit=50`
      ).then((data) => data.actions ?? []),
    staleTime: 5000,
    refetchInterval: pollMs ?? false,
  });
}

/** GET /api/hub on a linked machine's own window; { linked: false } on a server */
export interface HubPeer {
  linked: boolean;
  /** Only a linked machine says this */
  machine?: boolean;
  hubName?: string;
  name?: string;
  offlineMs?: number;
  canContinue?: boolean;
  copies?: number;
  newestCopyAt?: number | null;
}

/**
 * What this AgentOS knows of the server it is linked to. Read from the
 * page's own origin: it matters in a machine's own window, where the
 * server may be off
 */
export function useHubPeer(pollMs?: number) {
  return useQuery({
    queryKey: [...machineKeys.all, "hub-peer"] as const,
    queryFn: () => readJson<HubPeer>(HUB_TARGET, "/api/hub"),
    staleTime: (query) => (query.state.data?.machine ? 2000 : Infinity),
    refetchInterval: (query) =>
      pollMs && query.state.data?.machine ? pollMs : false,
  });
}

/**
 * Where the copies of these sessions are and how fresh (lib/backup/place.ts).
 * `on` is the machine they live on, null for this server. Asked only once
 * a machine is linked
 */
export function usePlaces(ids: readonly string[], on: string | null) {
  const { data: machines } = useMachines();
  const linked =
    !!machines?.enabled &&
    machines.machines.some((m) => m.status === "approved");
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: [...machineKeys.all, "place", on ?? "hub", key] as const,
    queryFn: () =>
      readJson<PlaceView>(
        HUB_TARGET,
        `/api/machines/place?ids=${encodeURIComponent(key)}${on ? `&on=${on}` : ""}`
      ),
    enabled: linked && ids.length > 0,
    staleTime: 5000,
    refetchInterval: linked && ids.length > 0 ? 15000 : false,
  });
}

export const abilitiesKey = (target: string) =>
  [...machineKeys.all, "abilities", target] as const;

/** What one machine can do (lib/abilities-types.ts); `target` as fetchOn takes it */
export function useAbilities(target: string, on = true) {
  return useQuery({
    queryKey: abilitiesKey(target),
    queryFn: () => readJson<AbilitiesView>(target, "/api/abilities"),
    enabled: on,
    staleTime: 60_000,
  });
}

/**
 * What each place a session can go can do, by its id ("hub" or a
 * machine's), as this server last heard; null when it isn't known
 */
export function useTargetAbilities(): (id: string) => Abilities | null {
  const { data: machines } = useMachines();
  const { data } = useAbilities(HUB_TARGET, !!machines?.enabled);
  return (id) =>
    !data
      ? null
      : id === HUB_TARGET
        ? data.abilities
        : (data.peers.find((p) => p.id === id)?.abilities ?? null);
}

/** The copies of a machine's sessions kept on this server */
export function useMachineCopies(id: string | null, pollMs?: number) {
  return useQuery({
    queryKey: machineKeys.copies(id ?? ""),
    queryFn: () =>
      readJson<{ copies: BackupView[]; bytes: number; unconfirmed: number }>(
        HUB_TARGET,
        `/api/machines/${id}/backups`
      ),
    enabled: !!id,
    staleTime: 2000,
    refetchInterval: id ? (pollMs ?? false) : false,
  });
}

/** A take-over running on this server, polled until it ends */
export function useTakeJob(job: TakeJob | null) {
  return useQuery({
    queryKey: machineKeys.take(job?.id ?? ""),
    queryFn: () =>
      readJson<TakeJob>(
        HUB_TARGET,
        `/api/machines/${job!.machineId}/backups/${job!.sessionId}/take?job=${job!.id}`
      ),
    enabled: !!job,
    initialData: job ?? undefined,
    refetchInterval: (query) => {
      const step = query.state.data?.step;
      return step === "done" || step === "failed" ? false : 700;
    },
  });
}
