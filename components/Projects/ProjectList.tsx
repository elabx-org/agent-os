"use client";

import { useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { useSnapshot } from "valtio";
import { ChevronLeft, FolderPlus, List, Plus } from "lucide-react";
import { ProjectRow, type ProjectCounts } from "@/components/rows/AgentRow";
import { useBackgroundAgentsByProject } from "@/components/BackgroundAgents";
import { SessionListHeader } from "@/components/SessionList/SessionListHeader";
import { useSessionListMutations } from "@/components/SessionList/hooks/useSessionListMutations";
import { FolderPicker } from "@/components/FolderPicker";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ProjectSectionSkeleton } from "@/components/ui/skeleton";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import { useProjectsQuery, useCreateProject } from "@/data/projects";
import { useLongPress } from "@/hooks/useLongPress";
import { useViewport } from "@/hooks/useViewport";
import {
  STATE_BADGE_CLASS,
  fromBackgroundState,
  fromSessionStatus,
} from "@/lib/agent-state";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { openNew } from "@/stores/newSurface";
import { openProjectSettings } from "@/stores/projectSettings";
import {
  closePage,
  openPage,
  workspacePageStore,
} from "@/stores/workspacePage";
import type { SessionStatus } from "@/components/views/types";
import { NewProjectDialog } from "./NewProjectDialog";
import {
  ProjectActionItems,
  projectActionGroups,
  type ProjectActionHandlers,
} from "./projectActions";

interface ProjectListProps {
  sessions: Session[];
  projects: ProjectWithDevServers[];
  sessionStatuses: Record<string, SessionStatus>;
  /** Counts as amber and blue pills rather than words (the web sidebar) */
  pills?: boolean;
  onNewSession: (projectId: string) => void;
  onOpenTerminal: (projectId: string) => void;
  onStartDevServer: (projectId: string) => void;
  /** The old tree, for selecting, moving, forking and summarizing sessions */
  allSessions?: ReactNode;
}

/**
 * The Projects tab: one row per project with its counts; a tap opens its
 * page, a hold or right-click its actions, and a drag reorders.
 */
export function ProjectList({
  sessions,
  projects,
  sessionStatuses,
  pills,
  onNewSession,
  onOpenTerminal,
  onStartDevServer,
  allSessions,
}: ProjectListProps) {
  const { isTouch } = useViewport();
  const { isPending } = useProjectsQuery();
  const createProject = useCreateProject();
  const mutations = useSessionListMutations({ onSelectSession: () => {} });
  const { page } = useSnapshot(workspacePageStore);
  const selectedId =
    page?.kind === "project" || page?.kind === "projectSettings"
      ? page.projectId
      : undefined;

  const [showAll, setShowAll] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const agentsByProject = useBackgroundAgentsByProject(projects);

  // Sessions and background agents together, by their state
  const counts = useMemo(() => {
    const byProject: Record<string, Required<ProjectCounts>> = {};
    const add = (projectId: string, state: string) => {
      const c = (byProject[projectId] ??= { agents: 0, needs: 0, work: 0 });
      c.agents++;
      if (state === "needs") c.needs++;
      if (state === "work") c.work++;
    };
    for (const s of sessions) {
      // Workers count with their conductor's view, not here
      if (s.conductor_session_id) continue;
      add(
        s.project_id || "uncategorized",
        fromSessionStatus(sessionStatuses[s.id]?.status ?? "idle")
      );
    }
    for (const [projectId, agents] of Object.entries(agentsByProject))
      for (const a of agents) add(projectId, fromBackgroundState(a.state));
    return byProject;
  }, [sessions, sessionStatuses, agentsByProject]);

  // Uncategorized always sorts last, so only the others move; it shows when
  // it holds something, or when it's the only project
  const movable = projects.filter((p) => !p.is_uncategorized);
  const fixed = projects.filter(
    (p) => p.is_uncategorized && (projects.length === 1 || counts[p.id])
  );

  const handlers = (
    project: ProjectWithDevServers
  ): Omit<ProjectActionHandlers, "onRename" | "onStartRename"> => {
    const own = !project.is_uncategorized;
    return {
      onNewSession: () => onNewSession(project.id),
      onNewBackgroundAgent: own
        ? () => openNew({ projectId: project.id, runAs: "background" })
        : undefined,
      onOpenTerminal: () => onOpenTerminal(project.id),
      onEdit: own ? () => openProjectSettings(project.id) : undefined,
      onStartDevServer: own ? () => onStartDevServer(project.id) : undefined,
      onDelete: own
        ? () => {
            if (selectedId === project.id) closePage();
            mutations.handleDeleteProject(project.id);
          }
        : undefined,
    };
  };
  const rename = (project: ProjectWithDevServers, name: string) => {
    if (name && name !== project.name)
      mutations.handleRenameProject(project.id, name);
  };
  const open = (project: ProjectWithDevServers) => {
    if (selectedId !== project.id)
      openPage({ kind: "project", projectId: project.id });
  };

  const sheetProject = projects.find((p) => p.id === sheetFor);

  if (showAll && allSessions)
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 px-3 pb-1 text-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          Projects
        </button>
        <div className="min-h-0 flex-1">{allSessions}</div>
      </div>
    );

  const empty = !isPending && movable.length === 0 && sessions.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SessionListHeader
        projectCount={movable.length}
        onNewProject={() => setShowNewProject(true)}
        onOpenProject={() => setShowFolderPicker(true)}
      />

      <div className="smooth-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-4">
        {isPending && projects.length === 0 && (
          <ProjectSectionSkeleton count={2} />
        )}

        {empty && (
          <div className="flex flex-col items-center justify-center px-4 py-12">
            <FolderPlus className="text-muted-foreground/50 mb-3 h-10 w-10" />
            <p className="text-muted-foreground mb-4 text-center text-sm">
              Create a project to organize your sessions
            </p>
            <Button onClick={() => setShowNewProject(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </div>
        )}

        <div className="space-y-px">
          <SortableList
            ids={movable.map((p) => p.id)}
            onReorder={mutations.handleReorderProjects}
            onHoldRelease={setSheetFor}
          >
            {movable.map((project) => (
              <SortableItem
                key={project.id}
                id={project.id}
                disabled={renamingId === project.id}
              >
                {(handle) => (
                  <div ref={handle.ref} {...handle.props}>
                    {renderRow(project, true)}
                  </div>
                )}
              </SortableItem>
            ))}
          </SortableList>
          {fixed.map((project) => (
            <div key={project.id}>{renderRow(project, false)}</div>
          ))}
        </div>

        {/* Session management that has no place on a project's page */}
        {allSessions && sessions.length > 0 && (
          <ProjectRow
            name="All sessions"
            icon={List}
            nosub
            onClick={() => setShowAll(true)}
            className="text-muted-foreground mt-2"
          />
        )}
      </div>

      {sheetProject && (
        <ActionSheet
          open={!!sheetFor}
          onOpenChange={(o) => !o && setSheetFor(null)}
          title={sheetProject.name}
          description={describe(counts[sheetProject.id])}
          groups={projectActionGroups(sheetProject, {
            ...handlers(sheetProject),
            onRename: (name) => rename(sheetProject, name),
          })}
        />
      )}

      <NewProjectDialog
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
        onCreated={() => setShowNewProject(false)}
      />
      {showFolderPicker && (
        <FolderPicker
          initialPath="~"
          onClose={() => setShowFolderPicker(false)}
          onSelect={(path) => {
            // Named after its folder
            const parts = path.split("/").filter(Boolean);
            const name = parts[parts.length - 1] || "project";
            createProject.mutate(
              {
                name,
                workingDirectory: path,
                agentType: "claude",
                defaultModel: "sonnet",
                devServers: [],
              },
              {
                onSuccess: () => setShowFolderPicker(false),
                onError: (err) => {
                  console.error("Failed to create project:", err);
                  setShowFolderPicker(false);
                },
              }
            );
          }}
        />
      )}
    </div>
  );

  function renderRow(project: ProjectWithDevServers, sortable: boolean) {
    const c = counts[project.id];
    const renaming = renamingId === project.id;
    const name = renaming ? (
      <RenameInput
        inputRef={nameInput}
        value={project.name}
        onDone={(next) => {
          setRenamingId(null);
          if (next !== null) rename(project, next);
        }}
      />
    ) : (
      project.name
    );
    const row = (
      <ListRow
        name={name}
        counts={c ?? { agents: 0 }}
        pills={pills}
        selected={project.id === selectedId}
        renaming={renaming}
        suggestions={project.suggestions}
        // A sortable row's hold is the list's (it lifts, or asks on release)
        onHold={
          isTouch && !sortable ? () => setSheetFor(project.id) : undefined
        }
        onClick={renaming ? undefined : () => open(project)}
      />
    );
    if (isTouch) return row;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent
          // Into the name being renamed, not back to the row
          onCloseAutoFocus={(e) => {
            if (!nameInput.current) return;
            e.preventDefault();
            nameInput.current.focus();
          }}
        >
          <ProjectActionItems
            context
            groups={projectActionGroups(project, {
              ...handlers(project),
              onStartRename: () => setRenamingId(project.id),
            })}
          />
        </ContextMenuContent>
      </ContextMenu>
    );
  }
}

/** "6 agents · 4 need you" for the actions sheet */
function describe(c: ProjectCounts | undefined): string {
  const agents = c?.agents ?? 0;
  const parts = [`${agents} agent${agents === 1 ? "" : "s"}`];
  if (c?.needs) parts.push(`${c.needs} need${c.needs === 1 ? "s" : ""} you`);
  if (c?.work) parts.push(`${c.work} working`);
  return parts.join(" · ");
}

interface ListRowProps extends React.HTMLAttributes<HTMLElement> {
  name: ReactNode;
  counts: ProjectCounts;
  pills?: boolean;
  selected?: boolean;
  renaming?: boolean;
  suggestions?: number;
  onHold?: () => void;
  ref?: Ref<HTMLElement>;
}

/** ProjectRow plus a hold on touch; spreads the rest for ContextMenuTrigger */
function ListRow({
  name,
  counts,
  pills,
  selected,
  renaming,
  suggestions,
  onHold,
  ref,
  ...rest
}: ListRowProps) {
  const rowRef = useRef<HTMLElement>(null);
  useLongPress(rowRef, onHold);
  // The hold's and the menu trigger's
  const setRef = (el: HTMLElement | null) => {
    rowRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const needs = counts.needs ?? 0;
  const work = counts.work ?? 0;

  return (
    <ProjectRow
      ref={setRef}
      name={name}
      counts={counts}
      nosub={pills}
      selected={selected}
      // An input can't sit inside a button
      as={renaming ? "div" : "button"}
      className="data-[held]:bg-accent select-none [-webkit-touch-callout:none]"
      badges={
        // Suggested instructions waiting in the project's settings
        !!suggestions && (
          <span
            role="img"
            aria-label={`${suggestions} suggested instruction${suggestions === 1 ? "" : "s"}`}
            className="bg-primary h-2 w-2 shrink-0 rounded-full"
          />
        )
      }
      trailing={
        pills ? (
          <span className="flex gap-1.5">
            {needs > 0 && (
              <Pill className={STATE_BADGE_CLASS.needs} label="need you">
                {needs}
              </Pill>
            )}
            {work > 0 && (
              <Pill className={STATE_BADGE_CLASS.work} label="working">
                {work}
              </Pill>
            )}
          </span>
        ) : undefined
      }
      {...rest}
    />
  );
}

function Pill({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: number;
}) {
  return (
    <span
      role="img"
      aria-label={`${children} ${label}`}
      className={cn(
        "rounded-full px-[7px] py-0.5 text-[11px] font-semibold tabular-nums",
        className
      )}
    >
      {children}
    </span>
  );
}

function RenameInput({
  inputRef,
  value,
  onDone,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  /** The new name, or null when Esc kept the old one */
  onDone: (name: string | null) => void;
}) {
  // Esc ends the rename without saving, even if the input still blurs
  const keep = useRef(false);
  return (
    <input
      ref={inputRef}
      autoFocus
      defaultValue={value}
      aria-label="Project name"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(keep.current ? null : e.currentTarget.value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          // Ends the rename, not the page
          e.preventDefault();
          keep.current = true;
          e.currentTarget.blur();
        }
      }}
      className="border-primary w-full border-b bg-transparent outline-none"
    />
  );
}
