"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAsUser } from "@/lib/client/user-fetch";
import type {
  ConfigConflictError,
  ProjectConfigResponse,
  PutProjectConfigBody,
  PutProjectConfigResponse,
  RunScriptBody,
  RunScriptResponse,
  ScriptRun,
  ScriptRunLogResponse,
  ScriptRunsResponse,
  UntrustedConfigError,
} from "@/lib/project-config-types";

/**
 * M3: a project's `.agent-os.json` and its script runs, for the Scripts
 * sheet (U3.2) and the editor (U3.3). Thin wrappers over the M3 routes.
 */

export const projectConfigKeys = {
  config: (projectId: string) => ["projectConfig", projectId] as const,
  runs: (projectId: string) => ["scriptRuns", projectId] as const,
  log: (runId: string) => ["scriptRunLog", runId] as const,
};

/** A refused request: `body` is the route's JSON (conflict, untrusted, user_only) */
export class ProjectConfigError extends Error {
  constructor(
    readonly status: number,
    readonly body:
      | ConfigConflictError
      | UntrustedConfigError
      | { error: string; reason?: string }
  ) {
    super(body.error);
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new ProjectConfigError(res.status, body);
  return body as T;
}

const send = (url: string, method: string, body?: unknown) =>
  fetchAsUser(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export function useProjectConfig(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectConfigKeys.config(projectId ?? ""),
    queryFn: async () =>
      json<ProjectConfigResponse>(
        await fetch(`/api/projects/${projectId}/config`)
      ),
    enabled: !!projectId && projectId !== "uncategorized",
    staleTime: 10000,
  });
}

export function useSaveProjectConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PutProjectConfigBody) =>
      json<PutProjectConfigResponse>(
        await send(`/api/projects/${projectId}/config`, "PUT", body)
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: projectConfigKeys.config(projectId) }),
  });
}

export function useTrustProjectConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hash: string) =>
      json<{ ok: true }>(
        await send(`/api/projects/${projectId}/trust`, "POST", { hash })
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: projectConfigKeys.config(projectId) }),
  });
}

/** The last run of each script; polls faster while one is running */
export function useScriptRuns(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectConfigKeys.runs(projectId ?? ""),
    queryFn: async () =>
      (
        await json<ScriptRunsResponse>(
          await fetch(`/api/projects/${projectId}/scripts/runs`)
        )
      ).runs,
    enabled: !!projectId && projectId !== "uncategorized",
    refetchInterval: (q) =>
      Object.values(q.state.data ?? {}).some((r) => r.status === "running")
        ? 2000
        : 15000,
  });
}

export function useRunScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      scriptId,
      ...body
    }: RunScriptBody & { scriptId: string }) =>
      json<RunScriptResponse>(
        await send(
          `/api/projects/${projectId}/scripts/${encodeURIComponent(scriptId)}/run`,
          "POST",
          body
        )
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: projectConfigKeys.runs(projectId) }),
  });
}

export function useStopScriptRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) =>
      json<{ run: ScriptRun }>(
        await send(`/api/script-runs/${runId}/stop`, "POST")
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: projectConfigKeys.runs(projectId) }),
  });
}

/** A background run's log tail, polled while `live` */
export function useScriptRunLog(
  runId: string | null | undefined,
  { lines = 3, live = false }: { lines?: number; live?: boolean } = {}
) {
  return useQuery({
    queryKey: [...projectConfigKeys.log(runId ?? ""), lines],
    queryFn: async () =>
      (
        await json<ScriptRunLogResponse>(
          await fetch(`/api/script-runs/${runId}/log?lines=${lines}`)
        )
      ).lines,
    enabled: !!runId,
    refetchInterval: live ? 2000 : false,
  });
}
