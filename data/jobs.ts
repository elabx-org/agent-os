"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOn } from "@/lib/client/machine";
import { refusalText, reprove } from "@/lib/client/user-fetch";
import { HUB_TARGET } from "@/lib/machine-marker";
import type { JobsView } from "@/lib/jobs/hub";
import {
  cleanJobMode,
  isOver,
  type Job,
  type JobMode,
  type JobSpace,
} from "@/lib/jobs/types";
import { useMachines } from "./machines";

export const jobKeys = {
  all: ["jobs"] as const,
  list: (session: string | null) =>
    [...jobKeys.all, "list", session ?? "all"] as const,
  space: (machine: string) => [...jobKeys.all, "space", machine] as const,
};

/** A machine is linked: there can be jobs at all */
function useLinked(): boolean {
  const { data } = useMachines();
  return !!data?.enabled && data.machines.some((m) => m.status === "approved");
}

/**
 * The jobs chats on this server handed to other machines, newest first:
 * one chat's, or all of them. Always the server's own list, whichever
 * machine the tab is on. Asked often while one is going
 */
export function useJobs(
  session: string | null = null,
  on = true,
  /** The chat is working: a job it sends shows within a few seconds */
  lively = true
) {
  const linked = useLinked();
  return useQuery({
    queryKey: jobKeys.list(session),
    queryFn: async (): Promise<JobsView> => {
      const res = await fetchOn(
        HUB_TARGET,
        `/api/jobs?limit=${session ? 30 : 100}${session ? `&session=${encodeURIComponent(session)}` : ""}`
      );
      if (!res.ok) throw new Error("Failed to read the jobs");
      return res.json();
    },
    enabled: linked && on,
    staleTime: 1500,
    refetchInterval: (query) =>
      !linked || !on
        ? false
        : query.state.data?.jobs.some((j) => !isOver(j.state))
          ? 2500
          : session && !lively
            ? 10000
            : session
              ? 5000
              : 12000,
  });
}

/** What jobs take on a machine's disk; null while it can't be asked */
/** One job by its id, for its sheet: fresh while it is going */
export function useJob(id: string | null) {
  return useQuery({
    queryKey: [...jobKeys.all, "one", id] as const,
    queryFn: async (): Promise<Job | null> => {
      const res = await fetchOn(HUB_TARGET, `/api/jobs/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to read the job");
      return ((await res.json()) as { job: Job }).job;
    },
    enabled: !!id,
    staleTime: 1000,
    refetchInterval: (query) =>
      !id
        ? false
        : query.state.data && isOver(query.state.data.state)
          ? 20000
          : 2500,
  });
}

export function useJobSpace(machine: string, on = true) {
  return useQuery({
    queryKey: jobKeys.space(machine),
    queryFn: async (): Promise<JobSpace | null> => {
      const res = await fetchOn(HUB_TARGET, `/api/jobs/space?on=${machine}`);
      if (!res.ok) return null;
      return ((await res.json()) as { space: JobSpace | null }).space;
    },
    enabled: on,
    staleTime: 30_000,
  });
}

/** The user's own action on the server: a fresh proof once if it went stale */
async function asUser(path: string, init: RequestInit): Promise<Response> {
  const send = () => fetchOn(HUB_TARGET, path, init);
  let res = await send();
  if (res.status === 403) {
    await reprove();
    res = await send();
  }
  return res;
}

const said = async (res: Response) =>
  refusalText(
    (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
  );

/** Stop, run again, clear: each answers null when done, else why not */
export function useJobActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: jobKeys.all });
  return {
    stop: async (job: Job): Promise<string | null> => {
      const res = await asUser(`/api/jobs/${job.id}`, { method: "DELETE" });
      await refresh();
      return res.ok ? null : said(res);
    },
    again: async (job: Job): Promise<string | null> => {
      const res = await asUser("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ again: job.id }),
      });
      await refresh();
      return res.ok ? null : said(res);
    },
    clear: async (
      machine: string,
      cache: string | null
    ): Promise<string | null> => {
      const res = await asUser(
        `/api/jobs/space?on=${machine}${cache ? `&cache=${encodeURIComponent(cache)}` : ""}`,
        { method: "DELETE" }
      );
      await client.invalidateQueries({ queryKey: jobKeys.space(machine) });
      return res.ok ? null : said(res);
    },
  };
}

export const jobModeKey = (machine: string) =>
  [...jobKeys.all, "mode", machine] as const;

/**
 * How much a job may do on a machine without asking: that machine's own
 * setting (`target` as fetchOn takes it). Nothing while it can't be asked
 */
export function useJobMode(target: string, on = true) {
  return useQuery({
    queryKey: jobModeKey(target),
    queryFn: async (): Promise<JobMode> => {
      const res = await fetchOn(target, "/api/jobs/settings");
      const mode = res.ok
        ? cleanJobMode(((await res.json()) as { mode?: unknown }).mode)
        : null;
      if (!mode) throw new Error("Failed to read it");
      return mode;
    },
    enabled: on,
    staleTime: 30_000,
    retry: false,
  });
}
