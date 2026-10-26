import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { AgentType } from "@/lib/providers";
import type { ProjectWithDevServers } from "@/lib/projects";
import { useNewSessionForm } from "@/components/NewSessionDialog/hooks/useNewSessionForm";
import { poll as refreshBackgroundAgents } from "@/components/BackgroundAgents";

export type RunAs = "session" | "background";

const RUN_AS_KEY = "agentOS:newRunAs";

function savedRunAs(): RunAs {
  try {
    return localStorage.getItem(RUN_AS_KEY) === "background"
      ? "background"
      : "session";
  } catch {
    return "session";
  }
}

export interface UseNewFormOptions {
  /** Whether the surface showing the form is open; defaults to true */
  open?: boolean;
  projects: ProjectWithDevServers[];
  selectedProjectId?: string;
  /** Starts on this instead of the remembered choice */
  runAs?: RunAs;
  onCreated: (sessionId: string) => void;
  /** After a background agent starts; onClose when left out */
  onStarted?: () => void;
  onClose: () => void;
  onCreateProject?: (
    name: string,
    workingDirectory: string,
    agentType: AgentType
  ) => Promise<string | null>;
}

/**
 * The New form's state, whatever shows it (page, dialog or sheet): a session
 * or a background agent, with submit, canSubmit and busy for its Start button
 */
export function useNewForm({
  open = true,
  projects,
  selectedProjectId,
  runAs: initialRunAs,
  onCreated,
  onStarted,
  onClose,
  onCreateProject,
}: UseNewFormOptions) {
  const session = useNewSessionForm({
    open,
    projects,
    selectedProjectId,
    onCreated,
    onClose,
    onCreateProject,
    // The worktree toggle starts off: the session works on the current branch
    gitBranchMode: "none",
  });

  const [runAs, setRunAsState] = useState<RunAs>(initialRunAs ?? "session");
  useEffect(() => {
    if (open) setRunAsState(initialRunAs ?? savedRunAs());
  }, [open, initialRunAs]);
  const setRunAs = useCallback((value: RunAs) => {
    setRunAsState(value);
    try {
      localStorage.setItem(RUN_AS_KEY, value);
    } catch {
      // Not remembered
    }
  }, []);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const background = runAs === "background";
  const task = session.initialPrompt;
  const worktree = session.branchMode === "worktree";
  const isGit = !!session.gitInfo?.isGitRepo;
  const busy = session.isLoading || starting;
  const canSubmit =
    !busy &&
    !!session.workingDirectory.trim() &&
    (background
      ? !!task.trim()
      : !worktree || (isGit && !!session.featureName.trim()));

  const setWorktree = (on: boolean) =>
    session.setBranchMode(on && isGit ? "worktree" : "none");

  const startBackground = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: session.workingDirectory,
          prompt: task,
          model: session.model || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Started in the background");
      session.setInitialPrompt("");
      // So it shows under its project now rather than at the next poll
      refreshBackgroundAgents();
      (onStarted ?? onClose)();
    } catch (error) {
      setStartError(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't start it"
      );
    } finally {
      setStarting(false);
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    if (background) startBackground();
    else session.handleSubmit();
  };

  // Background agents are Claude Code, so the model applies to them always;
  // other agents name their models differently
  const showModel = background || session.agentType === "claude";
  useEffect(() => {
    if (!showModel) session.setModel("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModel]);

  return {
    ...session,
    runAs,
    setRunAs,
    task,
    setTask: session.setInitialPrompt,
    worktree,
    setWorktree,
    isGit,
    showModel,
    submit,
    canSubmit,
    busy,
    error: background ? startError : session.error,
    handleClose: () => {
      setStartError(null);
      session.handleClose();
    },
  };
}

export type NewFormState = ReturnType<typeof useNewForm>;
