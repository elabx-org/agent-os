import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentType } from "@/lib/providers";
import { isValidProviderId } from "@/lib/providers/registry";
import type { ProjectWithDevServers } from "@/lib/projects";
import { branchForFeature, branchFromTask } from "@/lib/branch-name";
import { registerNavHandlers } from "@/lib/nav-actions";
import { agentName } from "@/components/a/Avatar";
import { useNewSessionForm } from "@/components/NewSessionDialog/hooks/useNewSessionForm";
import { poll as refreshBackgroundAgents } from "@/components/BackgroundAgents";
import { useEnsureTrusted } from "@/components/Projects/TrustConfigPrompt";
import { useProjectConfig } from "@/hooks/useProjectConfig";

export type RunAs = "session" | "background";

const RUN_AS_KEY = "agentOS:newRunAs";

/** The agents New → Permissions offers lib/permission-mode.ts's modes for */
const MODE_AGENTS: AgentType[] = ["claude", "codex", "gemini"];

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

  // Own worktree's branch: what was typed, else the task's, else the
  // folder's generated feature name
  const [branchEdit, setBranchEdit] = useState<string | null>(null);
  useEffect(() => {
    if (open) setBranchEdit(null);
  }, [open]);
  const featureName =
    branchEdit?.trim() || branchFromTask(task) || session.featureName.trim();
  const branch = featureName ? branchForFeature(featureName) : "";

  const canSubmit =
    !busy &&
    !!session.workingDirectory.trim() &&
    (background ? !!task.trim() : !worktree || (isGit && !!featureName));

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

  // A new worktree runs the project's setup steps: an unapproved
  // .agent-os.json asks first (M3)
  const trust = useEnsureTrusted(session.projectId);
  // Held across the trust check's fetch, so a second ✓ or Enter waits
  const submitting = useRef(false);
  const submit = async () => {
    if (!canSubmit || submitting.current) return;
    if (background) return startBackground();
    submitting.current = true;
    try {
      if (worktree && !(await trust.ensure())) return;
      await session.handleSubmit({ featureName });
    } finally {
      submitting.current = false;
    }
  };

  // The column's ✓ (E-New) starts what the form holds while it shows
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!open) return;
    return registerNavHandlers({ startNew: () => void submitRef.current() });
  }, [open]);

  // Background agents are Claude Code, so the model applies to them always;
  // other agents name their models differently
  const showModel = background || session.agentType === "claude";
  useEffect(() => {
    if (!showModel) session.setModel("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModel]);

  // Modes only for agents that take them; the rest keep auto-approve
  const showPermissions =
    !background && MODE_AGENTS.includes(session.agentType);
  useEffect(() => {
    if (!showPermissions) session.setPermissionMode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPermissions]);

  // The project's .agent-os.json defaults (approved ones only, as the
  // server resolves them) preset the form once per project; what the user
  // then picks is sent as usual
  const { data: projectConfig } = useProjectConfig(session.projectId);
  const presetFor = useRef<string | null>(null);
  useEffect(() => {
    const id = session.projectId;
    if (!id || !projectConfig || presetFor.current === id) return;
    presetFor.current = id;
    const d = projectConfig.defaults;
    if (d.agent && isValidProviderId(d.agent)) session.setAgentType(d.agent);
    if (d.permissionMode) session.setPermissionMode(d.permissionMode);
    // Other agents' models come from the file on the server (showModel)
    if (d.model && d.agent === "claude") session.setModel(d.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.projectId, projectConfig]);

  const project = projects.find((p) => p.id === session.projectId);
  const projectName =
    project && !project.is_uncategorized
      ? project.name
      : session.workingDirectory.replace(/\/+$/, "").split("/").pop() ||
        session.workingDirectory;

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
    showPermissions,
    /** The branch Own worktree makes, as the server will name it */
    branch,
    /** The branch field: what was typed, else the suggestion */
    branchInput: branchEdit ?? branch,
    branchEdited: branchEdit !== null,
    setBranch: setBranchEdit,
    /** Claude, Codex…: the agent as Start names it */
    agentLabel: agentName(session.agentType),
    projectName,
    submit,
    canSubmit,
    trustPrompt: trust.prompt,
    busy,
    error: background ? startError : session.error,
    handleClose: () => {
      setStartError(null);
      session.handleClose();
    },
  };
}

export type NewFormState = ReturnType<typeof useNewForm>;
