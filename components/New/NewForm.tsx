"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Layers,
  Loader2,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectWithDevServers } from "@/lib/projects";
import {
  MODES,
  MODE_HINTS,
  MODE_LABELS,
  type Mode,
} from "@/lib/permission-mode";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { MODELS } from "@/components/BackgroundAgents";
import { GroupCard } from "@/components/a/GroupCard";
import { ProjectSelector } from "@/components/NewSessionDialog/ProjectSelector";
import { AgentSelector } from "@/components/NewSessionDialog/AgentSelector";
import { WorkingDirectoryInput } from "@/components/NewSessionDialog/WorkingDirectoryInput";
import { CreatingOverlay } from "@/components/NewSessionDialog/CreatingOverlay";
import { getProviderDefinition } from "@/lib/providers/registry";
import type { NewFormState } from "./useNewForm";

/**
 * A session's "sonnet" is what the server stores when none was chosen, so a
 * session can't ask for it; background agents pass the model as is
 */
const SESSION_MODELS = MODELS.filter((m) => m.id !== "sonnet");

// The radio value for no mode: the agent's (or project's) own default
const DEFAULT_MODE = "default";

/** A chosen permission mode stands out (N-PermNew's violet value) */
const MODE_SET = "text-violet-700 dark:text-violet-300";

const ROW_ICON = "text-muted-foreground h-4 w-4 flex-none";
const CHEVRON = "h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]";

/** E-New's switch: 51x31, iOS green */
function Toggle({
  checked,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[31px] w-[51px] flex-none rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-[#34C759]" : "bg-[rgba(120,120,128,0.32)]",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-transform",
          checked && "translate-x-5"
        )}
      />
    </button>
  );
}

/** An E-New option row: icon, name, value, chevron. A menu's trigger too */
function OptionRow({
  icon: Icon,
  label,
  value,
  valueClassName,
  ...button
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  valueClassName?: string;
} & Omit<ComponentProps<"button">, "value">) {
  return (
    <button
      type="button"
      {...button}
      className="row active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 w-full text-left"
    >
      <Icon aria-hidden className={ROW_ICON} />
      <span className="min-w-0 flex-1 text-[16px]">{label}</span>
      <span
        className={cn(
          "text-muted-foreground max-w-[60%] truncate text-[14px]",
          valueClassName
        )}
      >
        {value}
      </span>
      <ChevronRight aria-hidden strokeWidth={2} className={CHEVRON} />
    </button>
  );
}

/** Own worktree's branch: mono, edited in place */
function BranchInput({
  form,
  className,
}: {
  form: NewFormState;
  className?: string;
}) {
  return (
    <input
      value={form.branchInput}
      onChange={(e) => form.setBranch(e.target.value)}
      // Left, it reads as the branch the server will make of it; emptied,
      // the suggestion comes back
      onBlur={() => {
        if (form.branchEdited)
          form.setBranch(form.branchInput.trim() ? form.branch : null);
      }}
      aria-label="Branch"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      size={Math.max(8, form.branchInput.length)}
      className={cn(
        "text-muted-foreground focus:text-foreground max-w-full min-w-0 bg-transparent font-mono text-[12px] outline-none",
        className
      )}
    />
  );
}

/**
 * The Permissions choices: a menu on a pointer, a sheet on touch
 * (ui/dropdown-menu). Full access is offered: this is the user's own UI,
 * and the server caps an agent's request anyway.
 */
function ModeItems({ form }: { form: NewFormState }) {
  const { mode } = choiceLabels(form);
  return (
    <DropdownMenuRadioGroup
      value={mode ?? DEFAULT_MODE}
      onValueChange={(v) => {
        if (v === DEFAULT_MODE) {
          form.setPermissionMode(null);
          // Else the old auto-approve toggle would still skip every prompt
          form.handleSkipPermissionsChange(false);
        } else form.setPermissionMode(v as Mode);
      }}
    >
      <DropdownMenuRadioItem value={DEFAULT_MODE}>
        <span className="flex min-w-0 flex-col">
          <span>Default</span>
          <span className="text-muted-foreground text-xs">
            As the project and agent are set up
          </span>
        </span>
      </DropdownMenuRadioItem>
      {MODES.map((m) => (
        <DropdownMenuRadioItem key={m} value={m}>
          <span className="flex min-w-0 flex-col">
            <span>{MODE_LABELS[m]}</span>
            <span className="text-muted-foreground text-xs">
              {MODE_HINTS[m]}
            </span>
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function sessionModels(form: NewFormState) {
  return form.runAs === "background" ? MODELS : SESSION_MODELS;
}

function ModelItems({ form }: { form: NewFormState }) {
  return (
    <DropdownMenuRadioGroup value={form.model} onValueChange={form.setModel}>
      {sessionModels(form).map((m) => (
        <DropdownMenuRadioItem key={m.id} value={m.id}>
          {m.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** What the rows and boxes say for the model and the mode */
function choiceLabels(form: NewFormState) {
  const model =
    sessionModels(form).find((m) => m.id === form.model)?.label ?? "Default";
  // The old auto-approve toggle, still on, is full access
  const mode: Mode | null =
    form.permissionMode ?? (form.skipPermissions ? "bypassPermissions" : null);
  return { model, mode, modeLabel: mode ? MODE_LABELS[mode] : "Default" };
}

/** "Start Claude in agent-os"; short: "Start Claude" (D-New) */
export function startLabel(form: NewFormState, short?: boolean): string {
  if (form.runAs === "background")
    return short ? "Start" : `Start in ${form.projectName}`;
  return short
    ? `Start ${form.agentLabel}`
    : `Start ${form.agentLabel} in ${form.projectName}`;
}

/** E-New's full-width Start: 52px, radius 26 */
export function StartPill({
  form,
  className,
}: {
  form: NewFormState;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={form.submit}
      disabled={!form.canSubmit}
      className={cn(
        "pill pill-primary h-[52px] w-full min-w-0 rounded-[26px] text-[16px] disabled:opacity-50",
        className
      )}
    >
      {form.busy && <Loader2 className="h-4 w-4 animate-spin" />}
      <span className="truncate">{startLabel(form)}</span>
    </button>
  );
}

/** Folded away: run as a background agent, the folder, name, old toggles */
function MoreOptions({ form, wide }: { form: NewFormState; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const background = form.runAs === "background";
  const provider = getProviderDefinition(form.agentType);
  const check = (
    id: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    label: string,
    hint: string,
    disabled?: boolean
  ) => (
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

  return (
    <div className={cn(!wide && "text-center")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-1 text-[14px] transition-colors"
      >
        More options
        <ChevronDown
          aria-hidden
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="group-card mt-1 space-y-3 p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-[15px]">
              Run as a background agent
              <span className="text-muted-foreground block text-[13px]">
                Claude Code works on the task with nobody watching
              </span>
            </span>
            <Toggle
              checked={background}
              onChange={(on) => form.setRunAs(on ? "background" : "session")}
              label="Run as a background agent"
            />
          </div>
          <WorkingDirectoryInput
            value={form.workingDirectory}
            onChange={form.setWorkingDirectory}
            gitInfo={form.gitInfo}
            checkingGit={form.checkingGit}
            onBrowse={() => form.setShowDirectoryPicker(true)}
          />
          {!background && (
            <>
              <div className="space-y-1.5">
                <div className="text-muted-foreground text-xs font-medium">
                  Name
                </div>
                <Input
                  value={form.name}
                  onChange={(e) => form.setName(e.target.value)}
                  placeholder="Auto-generated if empty"
                />
              </div>
              {form.worktree && form.gitInfo && (
                <div className="space-y-1.5">
                  <div className="text-muted-foreground text-xs font-medium">
                    Base branch
                  </div>
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
                </div>
              )}
              {check(
                "new-use-tmux",
                form.useTmux,
                form.handleUseTmuxChange,
                "Use tmux session",
                "(enables detach/attach)"
              )}
              {/* Agents with modes choose under Permissions instead */}
              {!form.showPermissions &&
                check(
                  "new-skip-permissions",
                  form.skipPermissions,
                  form.handleSkipPermissionsChange,
                  "Auto-approve tool calls",
                  provider.autoApproveFlag
                    ? `(${provider.autoApproveFlag})`
                    : "(not supported)"
                )}
              {check(
                "new-continue-session",
                form.continueSession,
                form.handleContinueSessionChange,
                "Continue last session",
                provider.continueFlag
                  ? `(${provider.continueFlag})`
                  : "(not supported)",
                !provider.continueFlag
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface NewFormProps {
  form: NewFormState;
  projects: ProjectWithDevServers[];
  canCreateProject?: boolean;
  /**
   * compact: E-New / N-PermNew (closed, phone, the open Duo's page);
   * wide: D-New's centred column, with Cancel and Start on one line
   */
  layout?: "compact" | "wide";
  /** The large title; off where the surface draws its own */
  title?: boolean;
  /** compact: Start under the options; off where the surface pins it
      (tabletop's base, the touch sheet) */
  start?: boolean;
  /** wide: Cancel */
  onCancel?: () => void;
  className?: string;
}

/**
 * New: agent tiles, the task, project / model / permissions / Own worktree,
 * Start. ⌘↵ submits from anywhere in it, and so does the column's ✓
 * (useNewForm registers startNew).
 */
export function NewForm({
  form,
  projects,
  canCreateProject,
  layout = "compact",
  title = true,
  start = true,
  onCancel,
  className,
}: NewFormProps) {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const wide = layout === "wide";
  const background = form.runAs === "background";
  const { model, mode, modeLabel } = choiceLabels(form);
  const worktreeShown = !background && form.isGit;

  const projectPicker = projectsOpen && (
    <div className="group-card p-4">
      <ProjectSelector
        projects={projects}
        projectId={form.projectId}
        onProjectChange={(id) => {
          form.handleProjectChange(id);
          setProjectsOpen(false);
        }}
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
    </div>
  );

  const heading = title && (
    <h1 className={cn("t-large", !wide && "text-[30px]")}>
      {background ? "Background agent" : "New session"}
    </h1>
  );

  const task = (
    <label
      className={cn(
        "group-card block",
        wide ? "border border-[var(--hair)] p-4" : "px-3.5 py-3"
      )}
    >
      <span
        className={cn(
          "text-muted-foreground block text-[13px]",
          wide ? "mb-2" : "mb-1.5"
        )}
      >
        {/* D-New adds "· / for commands, @ for files": not until the
            composer's pickers come here (M2) */}
        {background ? "Task" : "Task (optional)"}
      </span>
      <textarea
        value={form.task}
        onChange={(e) => form.setTask(e.target.value)}
        rows={2}
        placeholder="What should it do?"
        className={cn(
          "placeholder:text-muted-foreground/60 block w-full resize-none bg-transparent outline-none",
          wide ? "h-[120px] text-[17px] leading-[1.5]" : "text-[16px]"
        )}
      />
    </label>
  );

  const keys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Not from the folder picker, which React bubbles through its portal
    if (
      e.key === "Enter" &&
      (e.metaKey || e.ctrlKey) &&
      e.currentTarget.contains(e.target as Node)
    ) {
      e.preventDefault();
      form.submit();
    }
  };

  const overlay = form.isLoading && (
    <CreatingOverlay isWorktree={form.worktree} step={form.creationStep} />
  );
  const directoryPicker = (
    <DirectoryPicker
      open={form.showDirectoryPicker}
      onClose={() => form.setShowDirectoryPicker(false)}
      onSelect={(path) => form.setWorkingDirectory(path)}
      initialPath={form.workingDirectory}
    />
  );
  const error = form.error && (
    <p className="text-sm text-red-500">{form.error}</p>
  );

  if (wide) {
    // D-New's .opt boxes
    const opt =
      "bg-card flex h-12 min-w-0 items-center gap-2.5 rounded-[14px] px-3.5 text-[14px]";
    const choices = [
      form.showModel ? model : null,
      form.showPermissions && mode ? modeLabel : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div
        className={cn("relative flex flex-col gap-5", className)}
        onKeyDown={keys}
      >
        {overlay}
        {heading}
        {!background && (
          <AgentSelector
            layout="row"
            value={form.agentType}
            onChange={form.handleAgentTypeChange}
          />
        )}
        {task}
        <div className="grid grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => setProjectsOpen(!projectsOpen)}
            aria-expanded={projectsOpen}
            className={cn(opt, "hover:bg-accent/50 text-left")}
          >
            <Folder aria-hidden className={ROW_ICON} />
            <span className="min-w-0 flex-1 truncate">{form.projectName}</span>
            <ChevronDown aria-hidden className={CHEVRON} />
          </button>
          {form.showModel || form.showPermissions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(opt, "hover:bg-accent/50 text-left")}
                >
                  <Layers aria-hidden className={ROW_ICON} />
                  <span className="min-w-0 flex-1 truncate">
                    {choices || "Default"}
                  </span>
                  <ChevronDown aria-hidden className={CHEVRON} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-80 min-w-64">
                {form.showModel && (
                  <>
                    <DropdownMenuLabel>Model</DropdownMenuLabel>
                    <ModelItems form={form} />
                  </>
                )}
                {form.showModel && form.showPermissions && (
                  <DropdownMenuSeparator />
                )}
                {form.showPermissions && (
                  <>
                    <DropdownMenuLabel>Permissions</DropdownMenuLabel>
                    <ModeItems form={form} />
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className={cn(opt, "text-muted-foreground")}>
              <Layers aria-hidden className={ROW_ICON} />
              <span className="min-w-0 flex-1 truncate">
                {form.agentLabel}&apos;s own settings
              </span>
            </div>
          )}
          <div className={opt}>
            <GitBranch aria-hidden className={ROW_ICON} />
            <span className="min-w-0 flex-1 truncate">Own worktree</span>
            <Toggle
              checked={form.worktree}
              onChange={form.setWorktree}
              disabled={!worktreeShown}
              label="Own worktree"
              className="-mr-1 scale-[0.8]"
            />
          </div>
        </div>
        {projectPicker}
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-[13px] leading-relaxed">
            Starts in{" "}
            <span className="font-mono text-[12px] break-all">
              {form.workingDirectory}
            </span>
            {form.worktree && form.branch ? (
              <>
                {" "}
                on a new branch <BranchInput form={form} />
              </>
            ) : form.gitInfo?.currentBranch && !background ? (
              <>
                {" "}
                on{" "}
                <span className="font-mono text-[12px]">
                  {form.gitInfo.currentBranch}
                </span>
              </>
            ) : null}
          </p>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={form.busy}
              className="pill pill-secondary"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={form.submit}
            disabled={!form.canSubmit}
            className="pill pill-primary disabled:opacity-50"
          >
            {form.busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {startLabel(form, true)}
            <kbd className="font-mono text-[12px] font-normal opacity-80">
              ⌘↵
            </kbd>
          </button>
        </div>
        {error}
        <MoreOptions form={form} wide />
        {directoryPicker}
      </div>
    );
  }

  return (
    <div
      className={cn("relative flex flex-col gap-3", className)}
      onKeyDown={keys}
    >
      {overlay}
      {heading}
      {!background && (
        <AgentSelector
          value={form.agentType}
          onChange={form.handleAgentTypeChange}
        />
      )}
      {task}
      <GroupCard aria-label="Options">
        <OptionRow
          icon={Folder}
          label="Project"
          value={form.projectName}
          aria-expanded={projectsOpen}
          onClick={() => setProjectsOpen(!projectsOpen)}
        />
        {form.showModel && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <OptionRow icon={Layers} label="Model" value={model} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              <ModelItems form={form} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {form.showPermissions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <OptionRow
                icon={Shield}
                label="Permissions"
                value={modeLabel}
                valueClassName={mode ? MODE_SET : undefined}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-80 min-w-64">
              <DropdownMenuLabel>Permissions</DropdownMenuLabel>
              <ModeItems form={form} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {worktreeShown && (
          <div className="row">
            <GitBranch aria-hidden className={ROW_ICON} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[16px]">Own worktree</span>
              {form.worktree && form.branch && (
                <BranchInput form={form} className="w-full" />
              )}
            </span>
            <Toggle
              checked={form.worktree}
              onChange={form.setWorktree}
              label="Own worktree"
            />
          </div>
        )}
      </GroupCard>
      {projectPicker}
      {error}
      {start && <StartPill form={form} />}
      <MoreOptions form={form} />
      {directoryPicker}
    </div>
  );
}
