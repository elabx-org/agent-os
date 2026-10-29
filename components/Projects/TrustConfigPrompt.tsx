"use client";

import { useProjectsQuery } from "@/data/projects";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ProjectConfigError,
  projectConfigKeys,
  useTrustProjectConfig,
} from "@/hooks/useProjectConfig";
import { useViewport } from "@/hooks/useViewport";
import { refusalText } from "@/lib/client/user-fetch";
import {
  CONFIG_FILE,
  looserDefaultMode,
  type AgentOsConfig,
  type ProjectConfigResponse,
} from "@/lib/project-config-types";
import { MODE_LABELS, type Mode } from "@/lib/permission-mode";
import { cn } from "@/lib/utils";
import { StepList } from "./ProjectConfigParts";
import { listScripts } from "./ProjectConfigText";

/** What needs approval in a config (canRun): setup steps, scripts, a looser default mode */
function commandsOf(config: AgentOsConfig) {
  const setup = Array.isArray(config.setup)
    ? config.setup.filter((s) => typeof s === "string" && s.trim())
    : [];
  const mode = looserDefaultMode(config);
  return {
    setup,
    scripts: listScripts(config),
    mode: mode ? (MODE_LABELS[mode as Mode] ?? mode) : null,
  };
}

/**
 * M3 (U3.3): approve a project's `.agent-os.json` before its setup steps or
 * scripts run: lists the commands, "Allow" (POST trust) or "Not now".
 */
export function TrustConfigPrompt({
  projectId,
  projectName,
  hash,
  config,
  open,
  onResult,
}: {
  projectId: string;
  projectName: string;
  hash: string;
  config: AgentOsConfig;
  open: boolean;
  onResult: (trusted: boolean) => void;
}) {
  const { isTouch } = useViewport();
  const trust = useTrustProjectConfig(projectId);
  const [error, setError] = useState<string | null>(null);
  const { setup, scripts, mode } = commandsOf(config);

  const allow = async () => {
    setError(null);
    try {
      await trust.mutateAsync(hash);
      onResult(true);
    } catch (err) {
      setError(
        err instanceof ProjectConfigError
          ? refusalText(err.body)
          : "Couldn't save that. Try again."
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !trust.isPending && onResult(false)}
    >
      <DialogContent
        className={cn(
          "flex max-h-[85vh] flex-col gap-4 overflow-y-auto sm:max-w-[480px]",
          !isTouch && "rounded-[28px] border-0 bg-[var(--sheet)] p-7"
        )}
      >
        <div className="flex items-start gap-3 pr-8">
          <ShieldAlert
            aria-hidden
            className="mt-0.5 h-6 w-6 flex-none text-[hsl(var(--needs))]"
          />
          <div className="min-w-0">
            <DialogTitle className="t-head">
              Run {projectName}&apos;s commands?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-1 text-[14px] leading-snug">
              <span className="font-mono text-[13px]">{CONFIG_FILE}</span> in{" "}
              {projectName} is new or changed. Agent-OS runs what it lists only
              once you allow this version.
            </DialogDescription>
          </div>
        </div>

        {setup.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h3 className="t-sec">When a worktree is created</h3>
            <StepList steps={setup} className="py-2" />
          </section>
        )}

        {scripts.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h3 className="t-sec">Scripts</h3>
            <ul className="group-card">
              {scripts.map((s) => (
                <li key={s.id} className="row min-h-0 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{s.name}</span>
                    <span className="text-muted-foreground block font-mono text-[12px] break-all">
                      {s.command}
                    </span>
                  </span>
                  {s.onWorktree && (
                    <span className="text-muted-foreground flex-none text-[12px]">
                      On worktree
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {mode && (
          <section className="flex flex-col gap-1.5">
            <h3 className="t-sec">New sessions</h3>
            <p className="group-card px-4 py-2.5 text-[15px]">
              Start in <span className="font-semibold">{mode}</span>
            </p>
          </section>
        )}

        {error && (
          <p role="alert" className="text-[13px] text-red-500">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            disabled={trust.isPending}
            onClick={() => onResult(false)}
            className="pill pill-secondary active:opacity-70 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={trust.isPending}
            onClick={() => void allow()}
            className="pill pill-primary active:opacity-80 disabled:opacity-50"
          >
            {trust.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Allow
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The folder name from the config's path: "/x/agent-os/.agent-os.json" → "agent-os" */
function folderName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "This project";
}

/**
 * Resolves true when nothing needs approval or the user allows it; the
 * caller renders `prompt`. For New session with a worktree and for Run.
 * When the config can't be read (the routes not there yet, a network
 * error) it resolves true: the server checks trust before running anyway.
 */
export function useEnsureTrusted(projectId: string | null | undefined): {
  ensure: () => Promise<boolean>;
  prompt: ReactNode;
} {
  const qc = useQueryClient();
  const projectName = useProjectsQuery().data?.find(
    (p) => p.id === projectId
  )?.name;
  const [asking, setAsking] = useState<ProjectConfigResponse | null>(null);
  const resolver = useRef<((trusted: boolean) => void) | null>(null);

  const ensure = useCallback(async (): Promise<boolean> => {
    if (!projectId || projectId === "uncategorized") return true;
    let data: ProjectConfigResponse;
    try {
      data = await qc.fetchQuery({
        queryKey: projectConfigKeys.config(projectId),
        queryFn: async () => {
          const res = await fetch(`/api/projects/${projectId}/config`);
          const body = await res
            .json()
            .catch(() => ({ error: `HTTP ${res.status}` }));
          if (!res.ok) throw new ProjectConfigError(res.status, body);
          return body as ProjectConfigResponse;
        },
        staleTime: 0,
      });
    } catch {
      return true;
    }
    // The server's verdict (canRun, shared with the prompt's list)
    if (data.trusted || !data.hash) return true;
    // One question at a time: a second ask answers the first "not now"
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setAsking(data);
    });
  }, [projectId, qc]);

  const answer = (trusted: boolean) => {
    resolver.current?.(trusted);
    resolver.current = null;
    setAsking(null);
  };

  const prompt =
    asking && projectId ? (
      <TrustConfigPrompt
        projectId={projectId}
        projectName={projectName ?? folderName(asking.path)}
        hash={asking.hash}
        config={asking.config}
        open
        onResult={answer}
      />
    ) : null;

  return { ensure, prompt };
}
