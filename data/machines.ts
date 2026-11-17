"use client";

import { useSyncExternalStore } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Session } from "@/lib/db";
import { fetchOn, tabMachine } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import type { AgentLike, MachineSource, MachineTag } from "@/lib/machine-now";
import type { SessionStatus } from "@/components/views/types";
import type { ProjectWithRepositories } from "@/lib/projects";

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
}

export interface MachinesResponse {
  enabled: boolean;
  machines: MachineView[];
}

export const machineKeys = {
  all: ["machines"] as const,
  list: () => [...machineKeys.all, "list"] as const,
  on: (target: string, what: string) =>
    [...machineKeys.all, "on", target, what] as const,
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
