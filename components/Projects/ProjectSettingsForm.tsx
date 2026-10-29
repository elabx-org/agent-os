"use client";

import { useState, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Server,
  GitBranch,
  Star,
  FolderOpen,
  ScrollText,
  Webhook,
  Settings2,
} from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { useUpdateProject, projectKeys } from "@/data/projects";
import { useQueryClient } from "@tanstack/react-query";
import { devServerKeys } from "@/data/dev-servers";
import { repositoryKeys } from "@/data/repositories";
import type { AgentType } from "@/lib/providers";
import type { Suggestion as ProjectSuggestion } from "@/lib/project-context";
import {
  HOOK_EVENTS,
  HOOK_EVENT_LABELS,
  TOOL_EVENTS,
  parseProjectHooks,
  type ProjectHook,
} from "@/lib/project-hooks";
import type {
  ProjectWithRepositories,
  DetectedDevServer,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "aider", label: "Aider" },
  { value: "cursor", label: "Cursor CLI" },
];

const MODEL_OPTIONS = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

interface DevServerConfig {
  id: string;
  name: string;
  type: "node" | "docker";
  command: string;
  port?: number;
  portEnvVar?: string;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface RepositoryConfig {
  id: string;
  name: string;
  path: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

/**
 * Project settings state and saving, shared by the dialog (web) and the page
 * (Duo). Lives outside the form so the dialog can hide for the folder picker
 * without losing edits.
 */
export function useProjectSettingsForm(
  project: ProjectWithRepositories | null,
  open: boolean
) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [defaultModel, setDefaultModel] = useState("sonnet");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [hooks, setHooks] = useState<ProjectHook[]>([]);
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [devServers, setDevServers] = useState<DevServerConfig[]>([]);
  const [repositories, setRepositories] = useState<RepositoryConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isDetectingRepos, setIsDetectingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderPickerRepoId, setFolderPickerRepoId] = useState<string | null>(
    null
  );

  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();

  // What a session in this project starts with, and suggested instructions
  useEffect(() => {
    if (!open || !project) return;
    let live = true;
    fetch(`/api/projects/${project.id}/context`)
      .then((res) => res.json())
      .then((data) => {
        if (!live) return;
        setNote(data.note ?? null);
        setSuggestions(data.suggestions ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, project]);

  const answerSuggestion = async (
    suggestion: ProjectSuggestion,
    action: "accept" | "dismiss"
  ) => {
    if (!project) return;
    const res = await fetch(
      `/api/projects/${project.id}/suggestions/${encodeURIComponent(suggestion.id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }
    );
    const data = await res.json().catch(() => ({}));
    setSuggestions(
      data.suggestions ?? suggestions.filter((s) => s.id !== suggestion.id)
    );
    queryClient.invalidateQueries({ queryKey: projectKeys.all });
    if (res.ok && action === "accept") {
      // Saved already; keep it in the form too, with any unsaved edits
      const line = `- ${suggestion.text.replace(/\s*\n\s*/g, " ").replace(/^[-*]\s+/, "")}`;
      setInstructions((prev) =>
        prev.trim() ? `${prev.trim()}\n${line}` : line
      );
    }
  };

  // Initialize form when project changes
  useEffect(() => {
    if (project) {
      setName(project.name);
      setWorkingDirectory(project.working_directory);
      setAgentType(project.agent_type);
      setDefaultModel(project.default_model);
      setInitialPrompt(project.initial_prompt || "");
      setInstructions(project.instructions || "");
      setHooks(parseProjectHooks(project.hooks));
      setDevServers(
        project.devServers.map((ds) => ({
          id: ds.id,
          name: ds.name,
          type: ds.type,
          command: ds.command,
          port: ds.port || undefined,
          portEnvVar: ds.port_env_var || undefined,
        }))
      );
      setRepositories(
        (project.repositories || []).map((repo) => ({
          id: repo.id,
          name: repo.name,
          path: repo.path,
          isPrimary: repo.is_primary,
        }))
      );
      // Reset folder picker state when project changes
      setFolderPickerRepoId(null);
    }
  }, [project]);

  // Reset folder picker when dialog closes
  useEffect(() => {
    if (!open) {
      setFolderPickerRepoId(null);
    }
  }, [open]);

  // Detect dev servers
  const detectDevServers = async () => {
    if (!workingDirectory) return;

    setIsDetecting(true);
    try {
      const res = await fetch("/api/projects/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingDirectory }),
      });

      if (res.ok) {
        const data = await res.json();
        const detected = (data.detected || []) as DetectedDevServer[];

        // Add detected servers that don't already exist
        const existingCommands = new Set(devServers.map((ds) => ds.command));
        const newServers = detected
          .filter((d) => !existingCommands.has(d.command))
          .map((d, i) => ({
            id: `new_${Date.now()}_${i}`,
            name: d.name,
            type: d.type,
            command: d.command,
            port: d.port,
            portEnvVar: d.portEnvVar,
            isNew: true,
          }));

        setDevServers((prev) => [...prev, ...newServers]);
      }
    } catch (err) {
      console.error("Failed to detect dev servers:", err);
    } finally {
      setIsDetecting(false);
    }
  };

  // Add new dev server config
  const addDevServer = () => {
    setDevServers((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}`,
        name: "",
        type: "node",
        command: "",
        isNew: true,
      },
    ]);
  };

  // Remove dev server config
  const removeDevServer = (id: string) => {
    setDevServers(
      (prev) =>
        prev
          .map((ds) =>
            ds.id === id
              ? ds.isNew
                ? null // Remove new items completely
                : { ...ds, isDeleted: true } // Mark existing for deletion
              : ds
          )
          .filter(Boolean) as DevServerConfig[]
    );
  };

  // Update dev server config
  const updateDevServer = (id: string, updates: Partial<DevServerConfig>) => {
    setDevServers((prev) =>
      prev.map((ds) => (ds.id === id ? { ...ds, ...updates } : ds))
    );
  };

  // Detect git repositories in working directory
  const detectRepositories = async () => {
    if (!workingDirectory) return;

    setIsDetectingRepos(true);
    try {
      // Check if the working directory itself is a git repo
      const res = await fetch(
        `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
      );
      if (res.ok) {
        const existingPaths = new Set(repositories.map((r) => r.path));
        if (!existingPaths.has(workingDirectory)) {
          // Extract repo name from path
          const pathParts = workingDirectory.split("/").filter(Boolean);
          const repoName = pathParts[pathParts.length - 1] || "Repository";

          setRepositories((prev) => [
            ...prev,
            {
              id: `new_${Date.now()}`,
              name: repoName,
              path: workingDirectory,
              isPrimary: prev.length === 0,
              isNew: true,
            },
          ]);
        }
      }
    } catch {
      // Not a git repo, that's okay
    } finally {
      setIsDetectingRepos(false);
    }
  };

  // Add new repository config - opens folder picker directly
  const addRepository = () => {
    const newId = `new_${Date.now()}`;
    setRepositories((prev) => [
      ...prev,
      {
        id: newId,
        name: "",
        path: "",
        isPrimary: prev.filter((r) => !r.isDeleted).length === 0,
        isNew: true,
      },
    ]);
    // Open folder picker for the new repository
    setFolderPickerRepoId(newId);
  };

  // Remove repository config
  const removeRepository = (id: string) => {
    setRepositories(
      (prev) =>
        prev
          .map((repo) =>
            repo.id === id
              ? repo.isNew
                ? null // Remove new items completely
                : { ...repo, isDeleted: true } // Mark existing for deletion
              : repo
          )
          .filter(Boolean) as RepositoryConfig[]
    );
  };

  // Update repository config
  const updateRepository = (id: string, updates: Partial<RepositoryConfig>) => {
    setRepositories((prev) =>
      prev.map((repo) => (repo.id === id ? { ...repo, ...updates } : repo))
    );
  };

  // Set a repository as primary
  const setRepositoryPrimary = (id: string) => {
    setRepositories((prev) =>
      prev.map((repo) => ({
        ...repo,
        isPrimary: repo.id === id,
      }))
    );
  };

  /** Saves everything; true when it all went through */
  const save = async (): Promise<boolean> => {
    if (!project) return false;
    setError(null);

    if (!name.trim()) {
      setError("Project name is required");
      return false;
    }

    setIsLoading(true);
    try {
      // Update project settings using mutation (properly invalidates cache)
      await updateProject.mutateAsync({
        projectId: project.id,
        name: name.trim(),
        workingDirectory,
        agentType,
        defaultModel,
        initialPrompt: initialPrompt.trim() || null,
        instructions: instructions.trim() || null,
        hooks: hooks.filter((h) => h.command.trim()),
      });

      // Handle dev server changes
      for (const ds of devServers) {
        if (ds.isDeleted && !ds.isNew) {
          // Delete existing dev server
          await fetch(`/api/projects/${project.id}/dev-servers/${ds.id}`, {
            method: "DELETE",
          });
        } else if (
          ds.isNew &&
          !ds.isDeleted &&
          ds.name.trim() &&
          ds.command.trim()
        ) {
          // Create new dev server
          await fetch(`/api/projects/${project.id}/dev-servers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: ds.name.trim(),
              type: ds.type,
              command: ds.command.trim(),
              port: ds.port || undefined,
              portEnvVar: ds.portEnvVar || undefined,
            }),
          });
        } else if (!ds.isNew && !ds.isDeleted) {
          // Update existing dev server
          await fetch(`/api/projects/${project.id}/dev-servers/${ds.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: ds.name.trim(),
              type: ds.type,
              command: ds.command.trim(),
              port: ds.port || undefined,
              portEnvVar: ds.portEnvVar || undefined,
            }),
          });
        }
      }

      // Handle repository changes
      for (const repo of repositories) {
        if (repo.isDeleted && !repo.isNew) {
          // Delete existing repository
          await fetch(`/api/projects/${project.id}/repositories/${repo.id}`, {
            method: "DELETE",
          });
        } else if (
          repo.isNew &&
          !repo.isDeleted &&
          repo.name.trim() &&
          repo.path.trim()
        ) {
          // Create new repository
          await fetch(`/api/projects/${project.id}/repositories`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: repo.name.trim(),
              path: repo.path.trim(),
              isPrimary: repo.isPrimary,
            }),
          });
        } else if (!repo.isNew && !repo.isDeleted) {
          // Update existing repository
          await fetch(`/api/projects/${project.id}/repositories/${repo.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: repo.name.trim(),
              path: repo.path.trim(),
              isPrimary: repo.isPrimary,
            }),
          });
        }
      }

      // Invalidate dev servers cache so list updates
      queryClient.invalidateQueries({ queryKey: devServerKeys.list() });
      // Invalidate repositories cache
      queryClient.invalidateQueries({
        queryKey: repositoryKeys.list(project.id),
      });
      return true;
    } catch (err) {
      console.error("Failed to update project:", err);
      setError("Failed to update project");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  /** Clears what shouldn't survive closing */
  const reset = () => {
    setError(null);
    setFolderPickerRepoId(null);
  };

  return {
    project,
    name,
    setName,
    workingDirectory,
    setWorkingDirectory,
    agentType,
    setAgentType,
    defaultModel,
    setDefaultModel,
    initialPrompt,
    setInitialPrompt,
    instructions,
    setInstructions,
    hooks,
    setHooks,
    suggestions,
    answerSuggestion,
    note,
    devServers,
    detectDevServers,
    addDevServer,
    removeDevServer,
    updateDevServer,
    repositories,
    setRepositories,
    detectRepositories,
    addRepository,
    removeRepository,
    updateRepository,
    setRepositoryPrimary,
    isLoading,
    isDetecting,
    isDetectingRepos,
    error,
    folderPickerRepoId,
    setFolderPickerRepoId,
    save,
    reset,
  };
}

export type ProjectSettingsFormState = ReturnType<
  typeof useProjectSettingsForm
>;

/** A group with a heading, its own buttons on the right and a hint below */
function Section({
  icon,
  title,
  actions,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-8 items-center gap-2">
        <h2 className="t-sec min-w-0 flex-1 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
      </div>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </section>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <label className="block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

/**
 * The project settings fields in groups: General, What sessions start with,
 * Hooks, Dev servers, Git repositories. Save is the host's: a submit button
 * in children (the dialog's footer) or one outside pointing at this form's id
 * (the page's header).
 */
export function ProjectSettingsForm({
  form,
  id,
  onSubmit,
  className,
  children,
}: {
  form: ProjectSettingsFormState;
  id?: string;
  onSubmit: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const visibleDevServers = form.devServers.filter((ds) => !ds.isDeleted);
  const visibleRepositories = form.repositories.filter(
    (repo) => !repo.isDeleted
  );
  const project = form.project;
  // The preview is what the server last built; say so when it's behind
  const unsaved =
    !!project &&
    (form.instructions.trim() !== (project.instructions ?? "").trim() ||
      form.initialPrompt.trim() !== (project.initial_prompt ?? "").trim());

  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={cn("@container space-y-7", className)}
    >
      <Section icon={<Settings2 />} title="General">
        <div className="grid gap-4 @lg:grid-cols-2">
          <Field label="Project Name">
            <Input
              value={form.name}
              onChange={(e) => form.setName(e.target.value)}
              placeholder="my-awesome-project"
            />
          </Field>

          <Field label="Working Directory">
            <Input
              value={form.workingDirectory}
              onChange={(e) => form.setWorkingDirectory(e.target.value)}
              placeholder="~/projects/my-app"
            />
          </Field>

          <Field label="Default Agent">
            <Select
              value={form.agentType}
              onValueChange={(v) => form.setAgentType(v as AgentType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Default Model">
            <Select
              value={form.defaultModel}
              onValueChange={form.setDefaultModel}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      {/* Instructions and the first message, and what they add up to */}
      <Section icon={<ScrollText />} title="What sessions start with">
        <Field label="Instructions">
          <Textarea
            value={form.instructions}
            onChange={(e) => form.setInstructions(e.target.value)}
            placeholder="e.g. The iOS app sets the mobile experience; the web app follows it."
            rows={4}
            className="resize-y"
          />
          <p className="text-muted-foreground text-xs">
            Standing rules for every Claude session in this project. Running
            sessions get changes with your next message to them.
          </p>
        </Field>

        {form.suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Suggested by sessions</p>
            <ul className="bg-secondary/60 divide-border/60 divide-y overflow-hidden rounded-xl">
              {form.suggestions.map((s) => (
                <li key={s.id} className="space-y-2 p-3">
                  <p className="text-sm whitespace-pre-wrap">{s.text}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                      {s.from ?? "A session"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => form.answerSuggestion(s, "dismiss")}
                    >
                      Dismiss
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => form.answerSuggestion(s, "accept")}
                    >
                      Add
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="First message for new sessions">
          <Textarea
            value={form.initialPrompt}
            onChange={(e) => form.setInitialPrompt(e.target.value)}
            placeholder="This prompt will be prepended to all sessions in this project..."
            rows={3}
            className="resize-none"
          />
          <p className="text-muted-foreground text-xs">
            Sent once, at the start of each new session&apos;s first message.
          </p>
        </Field>

        {form.note && (
          <details className="group bg-secondary/40 rounded-xl px-3 py-2">
            <summary className="text-primary cursor-pointer py-1 text-sm">
              Preview what sessions see
            </summary>
            <pre className="bg-secondary/60 mt-2 max-h-72 overflow-auto rounded-xl p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
              {form.note}
            </pre>
            <p className="text-muted-foreground mt-1 text-xs">
              {unsaved
                ? "As last saved; save to see your changes here."
                : "As last saved, for a session in this project."}
            </p>
          </details>
        )}
      </Section>

      {/* Hooks: Claude Code hooks every session in the project gets */}
      <Section
        icon={<Webhook />}
        title="Hooks"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              form.setHooks((prev) => [
                ...prev,
                { event: "PostToolUse", matcher: "", command: "" },
              ])
            }
          >
            <Plus className="mr-1 h-3 w-3" />
            Add hook
          </Button>
        }
        hint="Claude Code hooks for every Claude session in this project, given when it starts. Changes reach a running session when you restart it."
      >
        {form.hooks.map((hook, i) => {
          const update = (patch: Partial<ProjectHook>) =>
            form.setHooks((prev) =>
              prev.map((h, j) => (j === i ? { ...h, ...patch } : h))
            );
          return (
            <div key={i} className="bg-secondary/60 space-y-2 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={hook.event}
                  onValueChange={(v) =>
                    update({ event: v as ProjectHook["event"] })
                  }
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOOK_EVENTS.map((event) => (
                      <SelectItem key={event} value={event}>
                        {HOOK_EVENT_LABELS[event]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove hook"
                  onClick={() =>
                    form.setHooks((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {TOOL_EVENTS.has(hook.event) && (
                <Input
                  value={hook.matcher ?? ""}
                  onChange={(e) => update({ matcher: e.target.value })}
                  placeholder="Tools, e.g. Bash or Edit|Write (empty: all)"
                  className="font-mono text-xs"
                />
              )}
              <Input
                value={hook.command}
                onChange={(e) => update({ command: e.target.value })}
                placeholder="Command, e.g. npx prettier --write ."
                className="font-mono text-xs"
              />
            </div>
          );
        })}
      </Section>

      <Section
        icon={<Server />}
        title="Dev servers"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={form.detectDevServers}
              disabled={form.isDetecting || !form.workingDirectory}
            >
              {form.isDetecting ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Detect
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={form.addDevServer}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          </>
        }
      >
        {visibleDevServers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No dev servers configured.
          </p>
        ) : (
          <div className="grid gap-2 @2xl:grid-cols-2">
            {visibleDevServers.map((ds) => (
              <div
                key={ds.id}
                className="bg-accent/30 space-y-2 rounded-lg p-3"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={ds.name}
                    onChange={(e) =>
                      form.updateDevServer(ds.id, { name: e.target.value })
                    }
                    placeholder="Server name"
                    className="h-8 flex-1"
                  />
                  <Select
                    value={ds.type}
                    onValueChange={(v) =>
                      form.updateDevServer(ds.id, {
                        type: v as "node" | "docker",
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="node">Node</SelectItem>
                      <SelectItem value="docker">Docker</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove dev server"
                    onClick={() => form.removeDevServer(ds.id)}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  value={ds.command}
                  onChange={(e) =>
                    form.updateDevServer(ds.id, { command: e.target.value })
                  }
                  placeholder={
                    ds.type === "docker" ? "Service name" : "npm run dev"
                  }
                  className="h-8"
                />
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={ds.port || ""}
                    onChange={(e) =>
                      form.updateDevServer(ds.id, {
                        port: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="Port"
                    className="h-8 w-24"
                  />
                  <Input
                    value={ds.portEnvVar || ""}
                    onChange={(e) =>
                      form.updateDevServer(ds.id, {
                        portEnvVar: e.target.value,
                      })
                    }
                    placeholder="Port env var (e.g., PORT)"
                    className="h-8 flex-1"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={<GitBranch />}
        title="Git repositories"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={form.detectRepositories}
              disabled={form.isDetectingRepos || !form.workingDirectory}
            >
              {form.isDetectingRepos ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Detect
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={form.addRepository}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          </>
        }
        hint="Configure multiple git repositories to track changes across repos."
      >
        {visibleRepositories.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No repositories configured. Git changes will use the working
            directory.
          </p>
        ) : (
          <div className="grid gap-2 @2xl:grid-cols-2">
            {visibleRepositories.map((repo) => (
              <div
                key={repo.id}
                className="bg-accent/30 space-y-2 rounded-lg p-3"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={repo.name}
                    onChange={(e) =>
                      form.updateRepository(repo.id, { name: e.target.value })
                    }
                    placeholder="Repository name"
                    className="h-8 flex-1"
                  />
                  <Button
                    type="button"
                    variant={repo.isPrimary ? "default" : "ghost"}
                    size="icon-sm"
                    onClick={() => form.setRepositoryPrimary(repo.id)}
                    title={
                      repo.isPrimary ? "Primary repository" : "Set as primary"
                    }
                    className={repo.isPrimary ? "text-yellow-500" : ""}
                  >
                    <Star
                      className={`h-3 w-3 ${repo.isPrimary ? "fill-current" : ""}`}
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove repository"
                    onClick={() => form.removeRepository(repo.id)}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={repo.path}
                    onChange={(e) =>
                      form.updateRepository(repo.id, { path: e.target.value })
                    }
                    placeholder="~/path/to/repository"
                    className="h-8 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => form.setFolderPickerRepoId(repo.id)}
                    title="Browse folders"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {children}
    </form>
  );
}

/** The folder picker for a repository's path, while one is being chosen */
export function ProjectSettingsFolderPicker({
  form,
}: {
  form: ProjectSettingsFormState;
}) {
  const repoId = form.folderPickerRepoId;
  if (!repoId) return null;
  return (
    <FolderPicker
      key={repoId}
      initialPath={
        form.repositories.find((r) => r.id === repoId)?.path ||
        form.workingDirectory ||
        "~"
      }
      onSelect={(path) => {
        // Auto-fill name from path if empty
        const pathParts = path.split("/").filter(Boolean);
        const name = pathParts[pathParts.length - 1] || "Repository";

        // First close the picker
        form.setFolderPickerRepoId(null);

        // Then update the repository
        form.setRepositories((prev) =>
          prev.map((r) =>
            r.id === repoId ? { ...r, path, name: r.name || name } : r
          )
        );
      }}
      onClose={() => {
        // First close the picker
        form.setFolderPickerRepoId(null);

        // If the repo has no path (user cancelled on new repo), remove it
        form.setRepositories((prev) => {
          const repo = prev.find((r) => r.id === repoId);
          if (repo?.isNew && !repo.path) {
            return prev.filter((r) => r.id !== repoId);
          }
          return prev;
        });
      }}
    />
  );
}
