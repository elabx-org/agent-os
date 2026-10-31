"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, GitBranch, MoreHorizontal, Plus } from "lucide-react";
import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";
import { useBackgroundAgentsByProject } from "@/components/BackgroundAgents";
import {
  ProjectActionItems,
  projectActionGroups,
} from "@/components/Projects/projectActions";
import { useSessionListMutations } from "@/components/SessionList/hooks/useSessionListMutations";
import { Button } from "@/components/ui/button";
import { ActionSheet } from "@/components/ui/action-sheet";
import { MoveToWorktreeSheetPageHost } from "@/components/Session/MoveToWorktreeSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDevServersQuery } from "@/data/dev-servers";
import { useGitStatus } from "@/data/git/queries";
import { useMergedTodayQuery } from "@/data/projects";
import { useLayoutMode, type LayoutMode } from "@/hooks/useLayoutMode";
import { useListTitles } from "@/hooks/useSessionTitles";
import { useViewport } from "@/hooks/useViewport";
import { useIsNative } from "@/hooks/useIsNative";
import { registerNavHandlers, registerPageBack } from "@/lib/nav-actions";
import { nativeCaps } from "@/lib/native-bridge";
import { mobileNavActions } from "@/stores/mobileNav";
import { backPage } from "@/stores/workspacePage";
import { openProjectSettings } from "@/stores/projectSettings";
import { openNew } from "@/stores/newSurface";
import type { ProjectWithDevServers } from "@/lib/projects";
import { cn } from "@/lib/utils";
import {
  AgentsSection,
  InstructionsSection,
  MergedTodaySection,
  ProjectScripts,
  RunningSection,
  SessionsSection,
  changedFiles,
} from "./ProjectSections";

/** The page padding per posture, as Now's and Projects' */
const PAD: Record<LayoutMode, string> = {
  phone: "px-4 pt-[15px]",
  "duo-closed": "pt-[18px] pr-2 pl-5",
  tabletop: "px-4 pt-4",
  "duo-open": "pt-5 pr-5 pl-6",
  book: "pt-5 pr-5 pl-6",
  desktop: "pt-5 pr-5 pl-6",
};

function home(dir: string): string {
  return dir.replace(/^\/config(?=\/|$)/, "~");
}

/**
 * A project as a workspace (Closed-Project): its path and branch, New
 * session / Files / Changes, then its sessions, agents, what's running and
 * what merged today
 */
export function ProjectPage({
  page,
  view,
  onOpenSession,
}: PageProps<"project">) {
  const project = view.projects.find((p) => p.id === page.projectId);
  if (!project)
    return (
      <>
        <PageHeader title="Project" />
        <PageEmpty>This project is gone.</PageEmpty>
      </>
    );
  return (
    <ProjectWorkspace
      project={project}
      view={view}
      onOpenSession={onOpenSession}
    />
  );
}

function ProjectWorkspace({
  project,
  view,
  onOpenSession,
}: Omit<PageProps<"project">, "page"> & { project: ProjectWithDevServers }) {
  const { isTouch } = useViewport();
  const mode = useLayoutMode();
  const { sessions: all, sessionStatuses: statuses } = view;
  const uncategorized = project.is_uncategorized;

  // Its sessions, workers left to their conductor's view
  const sessions = useMemo(
    () =>
      all.filter(
        (s) =>
          !s.conductor_session_id &&
          (s.project_id || "uncategorized") === project.id
      ),
    [all, project.id]
  );
  // Files and Changes open the session last worked in on that view,
  // preferring one in the project's own folder (a worktree has its own)
  const recent = [...sessions].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
  const latest =
    recent.find((s) => s.working_directory === project.working_directory) ??
    recent[0];
  const titles = useListTitles(sessions);

  const agents = useBackgroundAgentsByProject(view.projects)[project.id] ?? [];

  const { data: allServers = [] } = useDevServersQuery();
  const servers = allServers.filter((s) => s.project_id === project.id);

  const { data: git } = useGitStatus(project.working_directory, {
    enabled: !uncategorized,
  });
  const files = changedFiles(git);
  const { data: merged = [] } = useMergedTodayQuery(
    uncategorized ? undefined : project.id
  );

  const mutations = useSessionListMutations({
    onSelectSession: (id) => {
      const session = all.find((s) => s.id === id);
      if (session) onOpenSession(session);
    },
  });

  const [renaming, setRenaming] = useState(false);
  // Esc ends the rename without saving, even if the input still blurs
  const keepName = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The column (the web's, or the iOS app's own) draws ⋯ (Closed-Project);
  // the phone's tab bar, the desktop and the iOS app before it takes the
  // column don't, so the page keeps its own
  const native = useIsNative();
  const ownMore =
    (native && !nativeCaps().column) || mode === "phone" || mode === "desktop";
  useEffect(() => {
    if (ownMore) return;
    return registerNavHandlers({
      openProjectSettings: () => setSheetOpen(true),
    });
  }, [ownMore]);
  // Back closes the sheet, and only the sheet
  useEffect(() => {
    if (sheetOpen) return registerPageBack("Close", () => setSheetOpen(false));
  }, [sheetOpen]);

  const newSession = () => view.handleNewSessionInProject(project.id);
  const newAgent = uncategorized
    ? undefined
    : () => openNew({ projectId: project.id, runAs: "background" });
  const settings = uncategorized
    ? undefined
    : () => openProjectSettings(project.id);
  const openView = (mode: "files" | "git") =>
    latest
      ? () => {
          onOpenSession(latest);
          mobileNavActions.requestViewMode(mode, latest.id);
        }
      : undefined;
  const openFiles = openView("files");
  const openChanges = openView("git");

  const handlers = {
    onNewSession: newSession,
    onNewBackgroundAgent: newAgent,
    onOpenTerminal: () => view.handleOpenTerminal(project.id),
    onEdit: settings,
    onStartDevServer: uncategorized
      ? undefined
      : () => view.handleStartDevServer(project.id),
    onDelete: uncategorized
      ? undefined
      : () => {
          backPage();
          mutations.handleDeleteProject(project.id);
        },
  };
  const rename = (name: string) => {
    if (name && name !== project.name)
      mutations.handleRenameProject(project.id, name);
  };

  const running = servers.filter((s) => s.status !== "stopped");
  const empty = !sessions.length && !agents.length && !running.length;
  const instructions = project.instructions?.trim();

  const title = renaming ? (
    <input
      ref={nameInput}
      autoFocus
      defaultValue={project.name}
      aria-label="Project name"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        if (!keepName.current) rename(e.currentTarget.value.trim());
        keepName.current = false;
        setRenaming(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          // Ends the rename, not the page
          e.preventDefault();
          keepName.current = true;
          e.currentTarget.blur();
        }
      }}
      className="border-primary w-full border-b bg-transparent outline-none"
    />
  ) : (
    project.name
  );

  // The mono path, then the branch as a chip
  const subtitle = (
    <>
      <span className="min-w-0 truncate font-mono text-[13px]">
        {home(project.working_directory)}
      </span>
      {git?.branch && (
        <span className="chip h-6 min-w-0 shrink px-[9px] text-[12px]">
          <GitBranch className="h-[13px] w-[13px] flex-none" />
          <span className="truncate">{git.branch}</span>
        </span>
      )}
    </>
  );

  const moreButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Project actions"
      // 44px whatever the text size (density moves rem)
      className="text-muted-foreground mb-0.5 size-[44px]"
      onClick={isTouch ? () => setSheetOpen(true) : undefined}
    >
      <MoreHorizontal className="h-5 w-5" />
    </Button>
  );
  const more = isTouch ? (
    moreButton
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{moreButton}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Into the name being renamed, not back to ⋯ (the open menu kept
        // the input's autoFocus)
        onCloseAutoFocus={(e) => {
          if (!nameInput.current) return;
          e.preventDefault();
          nameInput.current.focus();
        }}
      >
        <ProjectActionItems
          groups={projectActionGroups(project, {
            ...handlers,
            onStartRename: () => setRenaming(true),
          })}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="@container/page flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1.5rem,var(--pane-inset-bottom,env(safe-area-inset-bottom)))]",
          PAD[mode]
        )}
      >
        <div className="flex max-w-[760px] flex-col gap-3.5">
          <PageHeader
            large
            // The open Duo's right page: Projects is on the left one
            detail={mode === "duo-open" || mode === "book"}
            title={title}
            subtitle={subtitle}
            actions={ownMore ? more : undefined}
          />

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={newSession}
              className="pill pill-primary min-w-0 flex-1 active:opacity-80 @3xl/page:flex-none"
            >
              <Plus className="h-4 w-4 flex-none" strokeWidth={2.4} />
              New session
            </button>
            {!uncategorized && (
              <>
                <button
                  type="button"
                  onClick={openFiles}
                  disabled={!openFiles}
                  className="pill pill-secondary active:opacity-80 disabled:opacity-40"
                >
                  <Folder className="h-4 w-4 flex-none" />
                  Files
                </button>
                <button
                  type="button"
                  onClick={openChanges}
                  disabled={!openChanges}
                  aria-label={
                    files.length
                      ? `${files.length} changed file${files.length === 1 ? "" : "s"}`
                      : "Changes"
                  }
                  className="pill pill-secondary tabular-nums active:opacity-80 disabled:opacity-40"
                >
                  <GitBranch className="h-4 w-4 flex-none" />
                  {files.length > 0 && files.length}
                </button>
              </>
            )}
          </div>

          {empty && (
            <p className="text-muted-foreground px-1 text-[15px]">
              Nothing in {project.name} yet. Start a session
              {newAgent && " or a background agent"} here.
            </p>
          )}

          <SessionsSection
            sessions={sessions}
            statuses={statuses}
            titles={titles}
            activeSessionId={view.activeSession?.id}
            projects={view.projects}
            actions={mutations}
            onOpenSession={onOpenSession}
          />
          <AgentsSection agents={agents} />
          <RunningSection
            servers={servers}
            onRestart={mutations.handleRestartDevServer}
            onStop={mutations.handleStopDevServer}
            onRemove={mutations.handleRemoveDevServer}
          />
          <ProjectScripts project={project} />
          <MergedTodaySection prs={merged} />
          <InstructionsSection
            text={instructions}
            suggestions={project.suggestions ?? 0}
            onEdit={settings}
          />
        </div>
      </div>

      <ActionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={project.name}
        description={home(project.working_directory)}
        groups={projectActionGroups(project, { ...handlers, onRename: rename })}
      />
      <MoveToWorktreeSheetPageHost sessions={sessions} />
    </div>
  );
}
