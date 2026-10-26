"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/lib/providers";
import type { ProjectWithDevServers } from "@/lib/projects";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { MODELS } from "@/components/BackgroundAgents";
import { ProjectSelector } from "@/components/NewSessionDialog/ProjectSelector";
import { AgentSelector } from "@/components/NewSessionDialog/AgentSelector";
import { WorkingDirectoryInput } from "@/components/NewSessionDialog/WorkingDirectoryInput";
import { CreatingOverlay } from "@/components/NewSessionDialog/CreatingOverlay";
import { getProviderDefinition } from "@/lib/providers/registry";
import type { NewFormState, RunAs } from "./useNewForm";

const PROJECT_CHIPS = 3;

const AGENT_CHIPS: { value: AgentType; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

/**
 * A session's "sonnet" is what the server stores when none was chosen, so a
 * session can't ask for it; background agents pass the model as is
 */
const SESSION_MODELS = MODELS.filter((m) => m.id !== "sonnet");

function Field({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      {children}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        // 44pt to a finger, as New's main input on touch
        "flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors [@media(pointer:coarse)]:h-11",
        selected
          ? "bg-accent text-foreground border-transparent"
          : "border-border text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function CheckRow({
  id,
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="border-border bg-background accent-primary h-4 w-4 shrink-0 rounded"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm">
        {label}
        <span className="text-muted-foreground ml-1">{hint}</span>
      </label>
    </div>
  );
}

/**
 * The New form's fields: project, run as, task, agent and model, worktree,
 * and the rest folded away. Layout-agnostic: the surface around it (page,
 * dialog or sheet) draws the title and the Start button from form.submit,
 * form.canSubmit and form.busy. ⌘↵ submits from anywhere in it.
 */
export function NewForm({
  form,
  projects,
  canCreateProject,
  className,
}: {
  form: NewFormState;
  projects: ProjectWithDevServers[];
  canCreateProject?: boolean;
  className?: string;
}) {
  const [moreProjects, setMoreProjects] = useState(false);
  const [moreAgents, setMoreAgents] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const background = form.runAs === "background";

  // The chosen project always shows as a chip: first, unless it's already
  // among the first few, so tapping one doesn't reorder them. A wide form
  // has room for one more.
  const named = projects.filter((p) => !p.is_uncategorized);
  const selected = named.find((p) => p.id === form.projectId);
  const first = named.slice(0, PROJECT_CHIPS + 1);
  const chips =
    selected && !first.slice(0, PROJECT_CHIPS).includes(selected)
      ? [selected, ...first.filter((p) => p !== selected)].slice(
          0,
          PROJECT_CHIPS + 1
        )
      : first;
  // more… only for what neither width shows
  const moreChip =
    named.length > PROJECT_CHIPS + 1 || canCreateProject
      ? ""
      : named.length > PROJECT_CHIPS
        ? "@lg:hidden"
        : null;

  const agentChips = AGENT_CHIPS.some((a) => a.value === form.agentType)
    ? AGENT_CHIPS
    : [
        ...AGENT_CHIPS,
        {
          value: form.agentType,
          label: getProviderDefinition(form.agentType).name,
        },
      ];
  const models = background ? MODELS : SESSION_MODELS;
  const provider = getProviderDefinition(form.agentType);

  return (
    <div
      className={cn("@container relative space-y-4", className)}
      onKeyDown={(e) => {
        // Not from the folder picker, which React bubbles through its portal
        if (
          e.key === "Enter" &&
          (e.metaKey || e.ctrlKey) &&
          e.currentTarget.contains(e.target as Node)
        ) {
          e.preventDefault();
          form.submit();
        }
      }}
    >
      {form.isLoading && (
        <CreatingOverlay isWorktree={form.worktree} step={form.creationStep} />
      )}

      <Field label="Project">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((project, i) => (
            <Chip
              key={project.id}
              selected={project.id === form.projectId}
              onClick={() => form.handleProjectChange(project.id)}
              className={cn(i >= PROJECT_CHIPS && "hidden @lg:flex")}
            >
              {project.id === form.projectId && (
                <Folder className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{project.name}</span>
            </Chip>
          ))}
          {moreChip !== null && (
            <Chip
              selected={moreProjects}
              onClick={() => setMoreProjects(!moreProjects)}
              className={moreChip}
            >
              more…
            </Chip>
          )}
        </div>
        {moreProjects && (
          <ProjectSelector
            projects={projects}
            projectId={form.projectId}
            onProjectChange={form.handleProjectChange}
            workingDirectory={form.workingDirectory}
            agentType={form.agentType}
            showNewProject={form.showNewProject}
            onShowNewProjectChange={form.setShowNewProject}
            newProjectName={form.newProjectName}
            onNewProjectNameChange={form.setNewProjectName}
            creatingProject={form.creatingProject}
            onCreateProject={form.handleCreateProject}
            canCreateProject={!!canCreateProject}
          />
        )}
      </Field>

      <Field label="Run as">
        <div
          role="tablist"
          className="bg-secondary flex rounded-lg p-0.5 text-sm font-medium"
        >
          {(["session", "background"] as RunAs[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={form.runAs === id}
              onClick={() => form.setRunAs(id)}
              className={cn(
                "h-8 min-w-0 flex-1 truncate rounded-md px-2 transition-colors [@media(pointer:coarse)]:h-11",
                form.runAs === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {id === "session" ? "Session" : "Background agent"}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label={
          <>
            Task
            {!background && <span className="font-normal"> (optional)</span>}
          </>
        }
      >
        <textarea
          value={form.task}
          onChange={(e) => form.setTask(e.target.value)}
          rows={3}
          placeholder={
            background ? "What should it do?" : "Sent when the session starts"
          }
          className="bg-secondary/70 focus:ring-primary block w-full resize-none rounded-xl px-3 py-2.5 text-base outline-none focus:ring-2 md:text-sm"
        />
      </Field>

      {(!background || form.showModel) && (
        <div className="grid gap-4 @lg:grid-cols-2">
          {!background && (
            <Field label="Agent">
              <div className="flex flex-wrap gap-1.5">
                {agentChips.map((agent) => (
                  <Chip
                    key={agent.value}
                    selected={agent.value === form.agentType}
                    onClick={() => form.handleAgentTypeChange(agent.value)}
                  >
                    {agent.label}
                  </Chip>
                ))}
                <Chip
                  selected={moreAgents}
                  onClick={() => setMoreAgents(!moreAgents)}
                >
                  more…
                </Chip>
              </div>
              {moreAgents && (
                <AgentSelector
                  value={form.agentType}
                  onChange={form.handleAgentTypeChange}
                />
              )}
            </Field>
          )}
          {form.showModel && (
            <Field label="Model">
              <div className="flex flex-wrap gap-1.5">
                {models.map((m) => (
                  <Chip
                    key={m.id}
                    selected={form.model === m.id}
                    onClick={() => form.setModel(m.id)}
                  >
                    {m.label}
                  </Chip>
                ))}
              </div>
            </Field>
          )}
        </div>
      )}

      {!background && form.isGit && (
        <Field label="Worktree">
          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="min-w-0">New branch in its own folder</span>
            <Switch
              checked={form.worktree}
              onCheckedChange={form.setWorktree}
            />
          </label>
        </Field>
      )}

      <div className="border-border rounded-lg border">
        <button
          type="button"
          onClick={() => setOptionsOpen(!optionsOpen)}
          aria-expanded={optionsOpen}
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              optionsOpen && "rotate-90"
            )}
          />
          More options
        </button>
        {optionsOpen && (
          <div className="space-y-3 border-t px-3 py-3">
            <WorkingDirectoryInput
              value={form.workingDirectory}
              onChange={form.setWorkingDirectory}
              gitInfo={form.gitInfo}
              checkingGit={form.checkingGit}
              onBrowse={() => form.setShowDirectoryPicker(true)}
            />
            {!background && (
              <>
                <Field label="Name">
                  <Input
                    value={form.name}
                    onChange={(e) => form.setName(e.target.value)}
                    placeholder="Auto-generated if empty"
                  />
                </Field>
                {form.worktree && form.gitInfo && (
                  <div className="grid gap-3 @md:grid-cols-2">
                    <Field label="Feature name">
                      <Input
                        value={form.featureName}
                        onChange={(e) => form.setFeatureName(e.target.value)}
                        placeholder="add-dark-mode"
                      />
                    </Field>
                    <Field label="Base branch">
                      <Select
                        value={form.baseBranch}
                        onValueChange={form.setBaseBranch}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {form.gitInfo.branches.map((branch) => (
                            <SelectItem key={branch} value={branch}>
                              {branch}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                )}
                <CheckRow
                  id="new-use-tmux"
                  checked={form.useTmux}
                  onChange={form.handleUseTmuxChange}
                  label="Use tmux session"
                  hint="(enables detach/attach)"
                />
                <CheckRow
                  id="new-skip-permissions"
                  checked={form.skipPermissions}
                  onChange={form.handleSkipPermissionsChange}
                  label="Auto-approve tool calls"
                  hint={
                    provider.autoApproveFlag
                      ? `(${provider.autoApproveFlag})`
                      : "(not supported)"
                  }
                />
                <CheckRow
                  id="new-continue-session"
                  checked={form.continueSession}
                  onChange={form.handleContinueSessionChange}
                  disabled={!provider.continueFlag}
                  label="Continue last session"
                  hint={
                    provider.continueFlag
                      ? `(${provider.continueFlag})`
                      : "(not supported)"
                  }
                />
              </>
            )}
          </div>
        )}
      </div>

      {form.error && <p className="text-sm text-red-500">{form.error}</p>}

      <DirectoryPicker
        open={form.showDirectoryPicker}
        onClose={() => form.setShowDirectoryPicker(false)}
        onSelect={(path) => form.setWorkingDirectory(path)}
        initialPath={form.workingDirectory}
      />
    </div>
  );
}
