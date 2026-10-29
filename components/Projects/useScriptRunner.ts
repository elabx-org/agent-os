"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useEnsureTrusted } from "@/components/Projects/TrustConfigPrompt";
import { ProjectConfigError, useRunScript } from "@/hooks/useProjectConfig";
import { useViewport } from "@/hooks/useViewport";
import { refusalText } from "@/lib/client/user-fetch";
import type {
  ProjectScript,
  RunScriptResponse,
} from "@/lib/project-config-types";
import { requestTerminalRun } from "@/stores/scriptTerminal";

const isUntrusted = (e: unknown) =>
  e instanceof ProjectConfigError &&
  e.status === 409 &&
  e.body.error === "untrusted";

/** A refused run in words: user-only, not approved, not on this server yet */
export function runErrorText(e: unknown, name: string): string {
  if (e instanceof ProjectConfigError) {
    if (e.body.error === "user_only") return refusalText(e.body);
    if (isUntrusted(e)) return "Approve .agent-os.json to run its scripts";
    if (e.status === 501) return "Scripts can't run on this server yet";
    if (e.status === 404) return `${name} isn't in .agent-os.json any more`;
  }
  return `Couldn't run ${name}`;
}

export function stopErrorText(e: unknown, name: string): string {
  if (e instanceof ProjectConfigError && e.body.error === "user_only")
    return refusalText(e.body);
  return `Couldn't stop ${name}`;
}

export interface RunOptions {
  /** Instead of the trust prompt (a shortcut, which has nowhere to show it) */
  onUntrusted?: () => void;
  /** Say it started: nothing else shows a background run from a shortcut */
  announce?: boolean;
}

/**
 * Runs a project's script as the Scripts sheet's play does: asks to approve
 * the file first when the server says it isn't (409 untrusted), then hands
 * a terminal script's line to the session's shell drawer. Render `prompt`.
 *
 * `sessionId` is the session the sheet is over; terminal scripts run in its
 * shell drawer where the Pane has one (not the phone layout), else they run
 * in the background like the rest.
 */
export function useScriptRunner(
  projectId: string | null | undefined,
  sessionId: string | null | undefined
) {
  const runScript = useRunScript(projectId ?? "");
  const { ensure, prompt } = useEnsureTrusted(projectId);
  const { isMobile } = useViewport();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { mutateAsync } = runScript;

  const run = useCallback(
    async (
      script: ProjectScript,
      { onUntrusted, announce }: RunOptions = {}
    ): Promise<RunScriptResponse | null> => {
      if (!projectId) return null;
      const drawer = sessionId && !isMobile ? sessionId : undefined;
      const attempt = () =>
        mutateAsync({ scriptId: script.id, sessionId: drawer });
      setPendingId(script.id);
      try {
        let res: RunScriptResponse;
        try {
          res = await attempt();
        } catch (e) {
          if (!isUntrusted(e)) throw e;
          if (onUntrusted) {
            onUntrusted();
            return null;
          }
          if (!(await ensure())) return null;
          res = await attempt();
        }
        if (res.shellCommand && drawer) {
          requestTerminalRun({
            runId: res.runId,
            sessionId: drawer,
            shellCommand: res.shellCommand,
          });
        } else if (announce) {
          toast(`${script.name} started`);
        }
        return res;
      } catch (e) {
        toast.error(runErrorText(e, script.name));
        return null;
      } finally {
        setPendingId(null);
      }
    },
    [projectId, sessionId, isMobile, mutateAsync, ensure]
  );

  return { run, pendingId, prompt };
}
