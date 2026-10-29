"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useSnapshot } from "valtio";
import {
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  FolderInput,
  FolderOpen,
  FolderPlus,
  List,
  Pin,
  PinOff,
  Plus,
} from "lucide-react";
import { Avatar } from "@/components/a/Avatar";
import { GroupCard } from "@/components/a/GroupCard";
import { SectionTitle } from "@/components/a/SectionTitle";
import { StateDot } from "@/components/a/StateDot";
import { useBackgroundAgentsByProject } from "@/components/BackgroundAgents";
import { useSessionListMutations } from "@/components/SessionList/hooks/useSessionListMutations";
import { FolderPicker } from "@/components/FolderPicker";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ProjectSectionSkeleton } from "@/components/ui/skeleton";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import {
  useProjectsQuery,
  useCreateProject,
  useUpdateProjectPlacement,
} from "@/data/projects";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode, type LayoutMode } from "@/hooks/useLayoutMode";
import { useLongPress } from "@/hooks/useLongPress";
import { useViewport } from "@/hooks/useViewport";
import { fromBackgroundState, sessionState } from "@/lib/agent-state";
import type { Session } from "@/lib/db";
import { registerNavHandlers, runNav } from "@/lib/nav-actions";
import { nativeCaps } from "@/lib/native-bridge";
import {
  groupProjects,
  projectStatusLine,
  projectTone,
  reorderWithin,
  type ProjectActivity,
  type ProjectPlacement,
  type ProjectSort,
} from "@/lib/project-groups";
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
  onNewSession: (projectId: string) => void;
  onOpenTerminal: (projectId: string) => void;
  onStartDevServer: (projectId: string) => void;
  /** The old tree, for selecting, moving, forking and summarizing sessions */
  allSessions?: ReactNode;
}

/** The page padding per posture, as Now's (Main, E-iPhone, Open-Now) */
const PAD: Record<LayoutMode, string> = {
  phone: "px-4 pt-[15px]",
  "duo-closed": "pt-[18px] pr-2 pl-5",
  tabletop: "px-4 pt-4",
  "duo-open": "pt-5 pr-5 pl-6",
  book: "pt-5 pr-5 pl-6",
  desktop: "pt-5 pr-5 pl-6",
};

const WIDE: LayoutMode[] = ["duo-open", "book", "desktop"];

/** The column's sort item, remembered per device */
const SORT_KEY = "agentOS:projectSort";
const SORTS: { value: ProjectSort; label: string }[] = [
  { value: "manual", label: "Your order" },
  { value: "recent", label: "Recent" },
  { value: "name", label: "Name" },
];

/** As PATCH /api/projects/[id] allows */
const GROUP_NAME_MAX = 40;

// Hairlines between rows that sit in wrappers of their own (sortable)
const HAIRLINES =
  "[&>*+*]:border-t [&>*+*]:border-[var(--hair)] dark:[&>*+*]:border-white/[.06]";

const NO_ACTIVITY: ProjectActivity = {
  needs: 0,
  work: 0,
  agents: 0,
  lastActiveAt: null,
};

/** SQLite's "YYYY-MM-DD HH:MM:SS" is UTC without saying so */
function timeOf(value: string): number {
  const ms = Date.parse(
    /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : value.replace(" ", "T") + "Z"
  );
  return isNaN(ms) ? 0 : ms;
}

/**
 * The Projects page (E-Projects): a large title and the count, then Pinned,
 * the user's groups and the rest, a row per project with its colour and
 * what runs in it. A tap opens its page, a hold or right-click its actions,
 * and in your own order a drag reorders within a group.
 */
export function ProjectList({
  sessions,
  projects,
  sessionStatuses,
  onNewSession,
  onOpenTerminal,
  onStartDevServer,
  allSessions,
}: ProjectListProps) {
  const { isTouch } = useViewport();
  const mode = useLayoutMode();
  const native = useIsNative();
  const wide = WIDE.includes(mode);
  const { isPending } = useProjectsQuery();
  const createProject = useCreateProject();
  const placement = useUpdateProjectPlacement();
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
  // The project the touch sheet is for; it stays while the sheet closes, as
  // the sheet runs the chosen action only once it has animated away
  const [sheet, setSheet] = useState<{ id: string; open: boolean } | null>(
    null
  );
  const setSheetFor = (id: string) => setSheet({ id, open: true });
  const [newGroupFor, setNewGroupFor] = useState<string | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<ProjectSort>("manual");
  const nameInput = useRef<HTMLInputElement>(null);

  // After mount, so the first render matches the server's
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (SORTS.some((s) => s.value === saved)) setSort(saved as ProjectSort);
    } catch {
      // Storage blocked: your order
    }
  }, []);
  const pickSort = (next: ProjectSort) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // Kept for this visit only
    }
  };

  // The column's + and sort, while this page shows
  useEffect(
    () =>
      registerNavHandlers({
        openNewProject: () => setShowNewProject(true),
        openSort: () => setSortOpen(true),
      }),
    []
  );

  const agentsByProject = useBackgroundAgentsByProject(projects);

  // Sessions and background agents together, by their state, and when each
  // project's sessions last changed
  const activity = useMemo(() => {
    const byProject: Record<string, ProjectActivity> = {};
    const of = (projectId: string) =>
      (byProject[projectId] ??= { ...NO_ACTIVITY });
    const add = (projectId: string, state: string) => {
      const a = of(projectId);
      a.agents++;
      if (state === "needs") a.needs++;
      if (state === "work") a.work++;
    };
    for (const s of sessions) {
      // Workers count with their conductor's view, not here
      if (s.conductor_session_id) continue;
      const id = s.project_id || "uncategorized";
      add(id, sessionState(s, sessionStatuses[s.id]?.status));
      const a = of(id);
      const at = timeOf(s.updated_at);
      if (at && (a.lastActiveAt == null || at > a.lastActiveAt))
        a.lastActiveAt = at;
    }
    for (const [projectId, agents] of Object.entries(agentsByProject))
      for (const a of agents) add(projectId, fromBackgroundState(a.state));
    return byProject;
  }, [sessions, sessionStatuses, agentsByProject]);

  const groups = useMemo(
    () => groupProjects(projects, activity, sort),
    [projects, activity, sort]
  );
  const movable = projects.filter((p) => !p.is_uncategorized);

  // Every project but Uncategorized in your order: a drag's whole order, and
  // the groups in it (a pinned project keeps its group for when unpinned)
  const { manualOrder, groupNames } = useMemo(() => {
    const ordered = projects
      .filter((p) => !p.is_uncategorized)
      .sort((a, b) => a.sort_order - b.sort_order);
    const names = new Set<string>();
    for (const p of ordered) {
      const name = p.group_name?.trim();
      if (name) names.add(name);
    }
    return { manualOrder: ordered.map((p) => p.id), groupNames: [...names] };
  }, [projects]);

  const place = (projectId: string, next: ProjectPlacement) =>
    placement.mutate({ projectId, placement: next });

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

  /** Pin and Move to group on the sheet; Uncategorized has neither */
  const placementActions = (project: ProjectWithDevServers): SheetAction[] => {
    if (project.is_uncategorized) return [];
    const current = project.group_name?.trim() || null;
    return [
      {
        label: project.pinned ? "Unpin" : "Pin",
        icon: project.pinned ? PinOff : Pin,
        onSelect: () => place(project.id, { pinned: !project.pinned }),
      },
      {
        label: "Move to group…",
        icon: FolderInput,
        submenu: {
          title: "Move to group",
          groups: [
            groupNames.map((name) => ({
              label: name,
              checked: name === current,
              onSelect: () => place(project.id, { groupName: name }),
            })),
            [
              {
                label: "No group",
                checked: !current,
                onSelect: () => place(project.id, { groupName: null }),
              },
              {
                label: "New group…",
                icon: Plus,
                prompt: {
                  title: "New group",
                  value: "",
                  submitLabel: "Move",
                  onSubmit: (name) =>
                    place(project.id, {
                      groupName: name.slice(0, GROUP_NAME_MAX),
                    }),
                },
              },
            ],
          ],
        },
      },
    ];
  };

  /** Starting work, the project itself, Pin and groups, then Delete */
  const sheetGroups = (project: ProjectWithDevServers) => {
    const base = projectActionGroups(project, {
      ...handlers(project),
      onRename: (name) => rename(project, name),
    });
    const placed = placementActions(project);
    // Every project with placement has Delete, last and on its own
    return placed.length
      ? [...base.slice(0, -1), placed, ...base.slice(-1)]
      : base;
  };

  const renameGroup = (from: string, to: string) => {
    const name = to.trim().slice(0, GROUP_NAME_MAX);
    if (!name || name === from) return;
    for (const p of movable)
      if (p.group_name?.trim() === from) place(p.id, { groupName: name });
  };
  const ungroup = (name: string) => {
    for (const p of movable)
      if (p.group_name?.trim() === name) place(p.id, { groupName: null });
  };

  // The column's sort item: the order, then the groups to rename or undo
  const sortGroups: SheetAction[][] = [
    SORTS.map(({ value, label }) => ({
      label,
      checked: sort === value,
      onSelect: () => pickSort(value),
    })),
    [
      {
        label: "Edit groups",
        icon: FolderInput,
        submenu: {
          title: "Groups",
          groups: [
            groupNames.length
              ? groupNames.map((name) => ({
                  label: name,
                  submenu: {
                    title: name,
                    groups: [
                      [
                        {
                          label: "Rename",
                          prompt: {
                            title: "Rename group",
                            value: name,
                            onSubmit: (to: string) => renameGroup(name, to),
                          },
                        },
                        {
                          label: "Ungroup",
                          destructive: true,
                          onSelect: () => ungroup(name),
                        },
                      ],
                    ],
                  },
                }))
              : [
                  {
                    label: "Hold a project to move it into a group",
                    disabled: true,
                  },
                ],
          ],
        },
      },
    ],
  ];

  const sheetProject = projects.find((p) => p.id === sheet?.id);
  const newGroupProject = projects.find((p) => p.id === newGroupFor);

  if (showAll && allSessions)
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 px-3 pt-2 pb-1 text-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          Projects
        </button>
        <div className="min-h-0 flex-1">{allSessions}</div>
      </div>
    );

  const empty = !isPending && movable.length === 0 && sessions.length === 0;
  // The column (or the iOS app's own) holds Back, + and sort; the phone's
  // tab bar, the desktop sidebar and the iOS app before it takes the
  // column don't
  const appBar = native && !nativeCaps().column;
  const ownButtons = appBar || mode === "phone" || mode === "desktop";
  const count = (
    <span className="text-muted-foreground text-[14px] tabular-nums">
      {movable.length}
    </span>
  );
  // The ungrouped rest gets a title only below other groups
  const titled = groups.length > 1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* --home-pad-b: on a phone the list scrolls on under the tab bar */}
      <div
        className={cn(
          "smooth-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1.5rem+var(--home-pad-b,0px))]",
          PAD[mode]
        )}
      >
        <div className={cn("flex flex-col", wide ? "gap-3.5" : "gap-3")}>
          {appBar && (
            <button
              type="button"
              onClick={() => runNav("back")}
              aria-label="Back to Now"
              className="text-muted-foreground active:bg-accent -mb-2 -ml-2 flex h-[44px] w-[44px] items-center justify-center rounded-full"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <header className="flex items-end justify-between gap-3">
            {/* The count after the title when buttons hold the right
                (E-Projects has it alone on the right) */}
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="t-large">Projects</h1>
              {ownButtons && count}
            </div>
            <div className="flex shrink-0 items-end gap-1">
              {ownButtons && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit order and groups"
                    className="size-[44px]"
                    onClick={() => setSortOpen(true)}
                  >
                    <AlignLeft className="h-5 w-5" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Add project"
                        className="size-[44px]"
                      >
                        <Plus className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setShowNewProject(true)}>
                        <FolderPlus className="mr-2 h-3 w-3" />
                        New project
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setShowFolderPicker(true)}
                      >
                        <FolderOpen className="mr-2 h-3 w-3" />
                        Open a folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              {!ownButtons && count}
            </div>
          </header>

          {isPending && projects.length === 0 && (
            <ProjectSectionSkeleton count={2} />
          )}

          {empty && (
            <div className="flex flex-col items-center justify-center px-4 py-12">
              <FolderPlus className="text-muted-foreground/50 mb-3 h-10 w-10" />
              <p className="text-muted-foreground mb-4 text-center text-sm">
                Create a project to organize your sessions
              </p>
              <div className="flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowNewProject(true)}
                  className="pill pill-primary active:opacity-80"
                >
                  <Plus className="h-4 w-4" />
                  New project
                </button>
                <button
                  type="button"
                  onClick={() => setShowFolderPicker(true)}
                  className="pill pill-secondary active:opacity-80"
                >
                  <FolderOpen className="h-4 w-4" />
                  Open a folder
                </button>
              </div>
            </div>
          )}

          {groups.map((group) => {
            const title = group.name ?? (titled ? "Projects" : null);
            const own = group.projects.filter((p) => !p.is_uncategorized);
            const fixed = group.projects.filter((p) => p.is_uncategorized);
            return (
              <section
                key={group.pinned ? "\0pinned" : (group.name ?? "\0rest")}
                className={cn("flex flex-col", wide ? "gap-3.5" : "gap-3")}
              >
                {title && <SectionTitle>{title}</SectionTitle>}
                <GroupCard
                  aria-label={title ?? "Projects"}
                  className={HAIRLINES}
                >
                  {sort === "manual" ? (
                    <SortableList
                      ids={own.map((p) => p.id)}
                      onReorder={(ids) =>
                        mutations.handleReorderProjects(
                          reorderWithin(manualOrder, ids)
                        )
                      }
                      onHoldRelease={setSheetFor}
                    >
                      {own.map((project) => (
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
                  ) : (
                    own.map((project) => (
                      <div key={project.id}>{renderRow(project, false)}</div>
                    ))
                  )}
                  {fixed.map((project) => (
                    <div key={project.id}>{renderRow(project, false)}</div>
                  ))}
                </GroupCard>
              </section>
            );
          })}

          {/* Session management that has no place on a project's page */}
          {allSessions && sessions.length > 0 && (
            <GroupCard>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="row active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 min-h-12 w-full py-2.5 text-left"
              >
                <span className="bg-secondary text-muted-foreground flex h-7 w-7 flex-none items-center justify-center rounded-[9px]">
                  <List className="h-3.5 w-3.5" />
                </span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[16px]">
                  All sessions
                </span>
                <ChevronRight
                  aria-hidden
                  className="h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]"
                />
              </button>
            </GroupCard>
          )}
        </div>
      </div>

      {sheetProject && (
        <ActionSheet
          open={!!sheet?.open}
          onOpenChange={(o) => {
            if (!o) setSheet((s) => s && { ...s, open: false });
          }}
          title={sheetProject.name}
          description={describe(activity[sheetProject.id])}
          groups={sheetGroups(sheetProject)}
        />
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title="Order and groups"
        groups={sortGroups}
      />

      <NewGroupDialog
        project={newGroupProject}
        onClose={() => setNewGroupFor(null)}
        onSubmit={(name) => {
          if (newGroupProject)
            place(newGroupProject.id, {
              groupName: name.slice(0, GROUP_NAME_MAX),
            });
          setNewGroupFor(null);
        }}
      />

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
        project={project}
        name={name}
        activity={activity[project.id]}
        selected={project.id === selectedId}
        renaming={renaming}
        // A sortable row's hold is the list's (it lifts, or asks on release)
        onHold={
          isTouch && !sortable ? () => setSheetFor(project.id) : undefined
        }
        onClick={renaming ? undefined : () => open(project)}
      />
    );
    if (isTouch) return row;
    const current = project.group_name?.trim() || null;
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
          {!project.is_uncategorized && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => place(project.id, { pinned: !project.pinned })}
              >
                {project.pinned ? (
                  <PinOff className="mr-2 h-3 w-3" />
                ) : (
                  <Pin className="mr-2 h-3 w-3" />
                )}
                {project.pinned ? "Unpin" : "Pin"}
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FolderInput className="mr-2 h-3 w-3" />
                  Move to group
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {groupNames.map((group) => (
                    <ContextMenuItem
                      key={group}
                      disabled={group === current}
                      onSelect={() => place(project.id, { groupName: group })}
                    >
                      {group}
                    </ContextMenuItem>
                  ))}
                  {groupNames.length > 0 && <ContextMenuSeparator />}
                  <ContextMenuItem
                    disabled={!current}
                    onSelect={() => place(project.id, { groupName: null })}
                  >
                    No group
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => setNewGroupFor(project.id)}>
                    <Plus className="mr-2 h-3 w-3" />
                    New group…
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }
}

/** "6 agents · 4 need you" for the actions sheet */
function describe(a: ProjectActivity | undefined): string {
  const agents = a?.agents ?? 0;
  const parts = [`${agents} agent${agents === 1 ? "" : "s"}`];
  if (a?.needs) parts.push(`${a.needs} need${a.needs === 1 ? "s" : ""} you`);
  if (a?.work) parts.push(`${a.work} working`);
  return parts.join(" · ");
}

interface ListRowProps extends React.HTMLAttributes<HTMLElement> {
  project: ProjectWithDevServers;
  name: ReactNode;
  activity?: ProjectActivity;
  selected?: boolean;
  renaming?: boolean;
  onHold?: () => void;
  ref?: Ref<HTMLElement>;
}

/**
 * E-Projects' row: the project's letter tile, its name and status line, a
 * chevron. A hold on touch; spreads the rest for ContextMenuTrigger
 */
function ListRow({
  project,
  name,
  activity = NO_ACTIVITY,
  selected,
  renaming,
  onHold,
  ref,
  className,
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
  const status = projectStatusLine(activity);
  const suggestions = project.suggestions ?? 0;
  // An input can't sit inside a button
  const Tag = renaming ? "div" : "button";

  return (
    <Tag
      ref={setRef}
      type={renaming ? undefined : "button"}
      aria-current={selected || undefined}
      className={cn(
        "row w-full text-left select-none [-webkit-touch-callout:none]",
        selected && "sel",
        "active:bg-accent data-[held]:bg-accent [@media(pointer:fine)]:hover:bg-accent/50",
        className
      )}
      {...rest}
    >
      <Avatar
        label={project.name}
        tone={projectTone(project)}
        className="text-[16px]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[16px] font-medium">{name}</span>
          {/* Suggested instructions waiting in the project's settings */}
          {suggestions > 0 && (
            <span
              role="img"
              aria-label={`${suggestions} suggested instruction${suggestions === 1 ? "" : "s"}`}
              className="bg-primary h-2 w-2 shrink-0 rounded-full"
            />
          )}
        </span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[14px]">
          {status.state && <StateDot state={status.state} size={6} />}
          <span className="truncate">{status.text}</span>
        </span>
      </span>
      <ChevronRight
        aria-hidden
        strokeWidth={2}
        className="h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]"
      />
    </Tag>
  );
}

/** New group… from the right-click menu: a name, then the move */
function NewGroupDialog({
  project,
  onClose,
  onSubmit,
}: {
  project: ProjectWithDevServers | undefined;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const open = !!project;
  useEffect(() => {
    if (open) setName("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>
              {project && `${project.name} moves into it.`}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            maxLength={GROUP_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            aria-label="Group name"
            placeholder="iOS, Home lab…"
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
