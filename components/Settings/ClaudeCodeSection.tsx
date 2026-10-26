"use client";

import { useState } from "react";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { AgentRow } from "@/components/rows/AgentRow";
import { ClaudeConfigDialog } from "@/components/ClaudeConfig";
import { usePanes } from "@/contexts/PaneContext";
import { useSessionsQuery } from "@/data/sessions";
import { useProjectsQuery } from "@/data/projects";
import { SettingGroup } from "./SettingGroup";

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
