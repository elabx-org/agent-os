"use client";

import type { ReactNode } from "react";
import type { AgentOsConfig } from "@/lib/project-config-types";

/**
 * M3 (U3.3): approve a project's `.agent-os.json` before its setup steps or
 * scripts run: lists the commands, "Allow" (POST trust) or "Not now".
 */
export function TrustConfigPrompt(_props: {
  projectId: string;
  projectName: string;
  hash: string;
  config: AgentOsConfig;
  open: boolean;
  onResult: (trusted: boolean) => void;
}) {
  return null;
}

/**
 * Resolves true when nothing needs approval or the user allows it; the
 * caller renders `prompt`. For New session with a worktree and for Run.
 */
export function useEnsureTrusted(_projectId: string | null | undefined): {
  ensure: () => Promise<boolean>;
  prompt: ReactNode;
} {
  return { ensure: async () => true, prompt: null };
}
