"use client";

import { useState } from "react";
import { ChevronRight, Layers, SlidersHorizontal, Users } from "lucide-react";
import { AgentRow } from "@/components/rows/AgentRow";
import { ClaudeConfigDialog } from "@/components/ClaudeConfig";
import { usePanes } from "@/contexts/PaneContext";
import { useSessionsQuery } from "@/data/sessions";
import { useProjectsQuery } from "@/data/projects";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClaudeModels } from "@/data/claude-models";
import {
  CLAUDE_MODEL_CHOICES,
  CLAUDE_MODEL_VERSION_CHOICES,
  claudeModelName,
  subagentModelName,
} from "@/lib/claude-models";
import { isClaudeModel } from "@/lib/handoff-types";
import { SettingGroup } from "./SettingGroup";

/** "" in the menus: Claude Code's own default / the session's model */
const NONE = "none";

/** One model row: its menu holds the choices */
function ModelRow({
  icon,
  title,
  subtitle,
  value,
  choices,
  current,
  disabled,
  onPick,
}: {
  icon: typeof Layers;
  title: string;
  subtitle: string;
  value: string;
  choices: { id: string; label: string }[];
  current: string;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <AgentRow
          kind="setting"
          state="idle"
          icon={icon}
          title={title}
          subtitle={subtitle}
          dense
          trailing={
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-muted-foreground max-w-[10rem] truncate text-[14px]">
                {value}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="text-muted-foreground h-4 w-4"
              />
            </span>
          }
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuRadioGroup value={current} onValueChange={onPick}>
          {choices.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.label}
            </DropdownMenuRadioItem>
          ))}
          {/* Held on that exact version; the ones above follow each family */}
          <DropdownMenuLabel>Earlier versions</DropdownMenuLabel>
          {CLAUDE_MODEL_VERSION_CHOICES.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Models for new sessions: the main model and the sub-agents' (Claude's
 * CLAUDE_CODE_SUBAGENT_MODEL), in the app rather than a settings file. Each
 * session shows both in its header and can change them in Agent and model
 */
function ModelsGroup() {
  const { models, loaded, save, saving, error } = useClaudeModels();
  const pick = (id: string) => (isClaudeModel(id) ? id : null);
  return (
    <>
      <h3 className="text-muted-foreground mr-[var(--settings-gutter-r,20px)] -mb-1 ml-[var(--settings-gutter-l,20px)] pt-2 text-[13px] font-medium uppercase">
        Models for new sessions
      </h3>
      <SettingGroup className="divide-y-0 p-1">
        <ModelRow
          icon={Layers}
          title="Model"
          subtitle="Runs the session"
          value={
            models.model ? claudeModelName(models.model) : "Claude Code's own"
          }
          choices={[
            { id: NONE, label: "Claude Code's own default" },
            ...CLAUDE_MODEL_CHOICES.map((c) => ({
              id: c.alias,
              label: c.name,
            })),
          ]}
          current={models.model ?? NONE}
          disabled={!loaded || saving}
          onPick={(id) => void save({ model: pick(id) })}
        />
        <ModelRow
          icon={Users}
          title="Sub-agents"
          subtitle="Every agent it starts"
          value={subagentModelName(models.subagents)}
          choices={[
            { id: NONE, label: subagentModelName(null) },
            ...CLAUDE_MODEL_CHOICES.map((c) => ({
              id: c.alias,
              label: c.name,
            })),
          ]}
          current={models.subagents ?? NONE}
          disabled={!loaded || saving}
          onPick={(id) => void save({ subagents: pick(id) })}
        />
      </SettingGroup>
      <p className="text-muted-foreground mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)] text-[13px]">
        {error ??
          "Each session's header shows both. Change them for one session in its Agent and model sheet. A sub-agents model applies to every agent, including agent types that name their own."}
      </p>
    </>
  );
}

/** Claude Config: for the open session's project, else the first project */
export function ClaudeCodeSection() {
  const [open, setOpen] = useState(false);
  const { focusedPaneId, getActiveTab } = usePanes();
  const sessionId = getActiveTab(focusedPaneId)?.sessionId;
  const { data: sessionsData } = useSessionsQuery();
  const { data: projects = [] } = useProjectsQuery();
  const projectId = sessionsData?.sessions.find(
    (s) => s.id === sessionId
  )?.project_id;
  const projectPath = (
    projects.find((p) => p.id === projectId) ??
    projects.find((p) => !p.is_uncategorized)
  )?.working_directory;

  return (
    <>
      <ModelsGroup />
      <SettingGroup className="divide-y-0 p-1">
        <AgentRow
          kind="setting"
          state="idle"
          icon={SlidersHorizontal}
          title="Claude Config"
          subtitle="CLAUDE.md, skills, agents, MCP servers, plugins"
          dense
          onClick={() => setOpen(true)}
          trailing={
            <ChevronRight
              aria-hidden="true"
              className="text-muted-foreground h-4 w-4"
            />
          }
        />
      </SettingGroup>
      <ClaudeConfigDialog
        open={open}
        onClose={() => setOpen(false)}
        projectPath={projectPath}
      />
    </>
  );
}
