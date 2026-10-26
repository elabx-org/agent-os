"use client";

import { useMemo, useRef, useState } from "react";
import { Bot, MoreHorizontal, Plus } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDevServersQuery } from "@/data/dev-servers";
import { useGitStatus } from "@/data/git/queries";
import { useListTitles } from "@/hooks/useSessionTitles";
import { useViewport } from "@/hooks/useViewport";
import { mobileNavActions } from "@/stores/mobileNav";
import { backPage, openPage } from "@/stores/workspacePage";
import { openNew } from "@/stores/newSurface";
import type { ProjectWithDevServers } from "@/lib/projects";
import {
  AgentsSection,
  ChangesSection,
  DevServerSection,
  InstructionsSection,
  NeedsYouSection,
  SessionsSection,
  changedFiles,
} from "./ProjectSections";

/** Waiting agents listed one by one where there's room, as on the open Duo */
const LOOSE_WAITING_WIDE = 8;

function home(dir: string): string {
  return dir.replace(/^\/config(?=\/|$)/, "~");
}

/** A project as a workspace: its sessions, agents, dev server and changes */
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
  const { isMobile, isTouch } = useViewport();
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
  const waiting = sessions.filter((s) => statuses[s.id]?.status === "waiting");
  // Pinned first, as in the project list; waiting ones are in Needs you
  const listed = sessions
    .filter((s) => statuses[s.id]?.status !== "waiting")
    .sort(
      (a, b) =>
        (a.pinned_order ?? Number.MAX_SAFE_INTEGER) -
        (b.pinned_order ?? Number.MAX_SAFE_INTEGER)
    );
  // Review and Commit open the session last worked in on its Changes,
  // preferring one in the project's own folder (a worktree has its own)
  const recent = [...sessions].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
  const latest =
    recent.find((s) => s.working_directory === project.working_directory) ??
    recent[0];
  const titles = useListTitles(sessions);

  const agents = useBackgroundAgentsByProject(view.projects)[project.id] ?? [];
  const blocked = agents.filter((a) => a.state === "blocked");
  const otherAgents = agents.filter((a) => a.state !== "blocked");

  const { data: allServers = [] } = useDevServersQuery();
  const servers = allServers.filter((s) => s.project_id === project.id);

  const { data: git } = useGitStatus(project.working_directory, {
    enabled: !uncategorized,
  });
  const files = changedFiles(git);

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

  const newSession = () => view.handleNewSessionInProject(project.id);
  const newAgent = uncategorized
    ? undefined
    : () => openNew({ projectId: project.id, runAs: "background" });
  const settings = uncategorized
    ? undefined
    : () => openPage({ kind: "projectSettings", projectId: project.id });
  const review = latest
    ? () => {
        onOpenSession(latest);
        mobileNavActions.requestViewMode("git", latest.id);
      }
    : undefined;

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

  const empty =
    !sessions.length && !agents.length && !servers.length && !files.length;
  const instructions = project.instructions?.trim();

  const subtitle = [
    home(project.working_directory),
    git?.branch,
    files.length > 0 && `${files.length} changed`,
  ]
    .filter(Boolean)
    .join(" · ");

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
    <span className="@3xl/page:text-2xl">{project.name}</span>
  );

  const more = isTouch ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Project actions"
      onClick={() => setSheetOpen(true)}
    >
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Project actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
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

  // Narrow (a phone, the closed Duo): ⋯ here and the buttons at the bottom.
  // Medium (a page of the open Duo): + New. Wide (the web): both buttons
  const actions = (
    <>
      {newAgent && (
        <Button
          variant="outline"
          size="sm"
          className="hidden md:@3xl/page:inline-flex"
          onClick={newAgent}
        >
          <Bot />
          Background agent
        </Button>
      )}
      <Button
        size="sm"
        className="hidden md:inline-flex md:@3xl/page:hidden"
        onClick={newSession}
      >
        <Plus />
        New
      </Button>
      <Button
        size="sm"
        className="hidden md:@3xl/page:inline-flex"
        onClick={newSession}
      >
        <Plus />
        New session
      </Button>
      {more}
    </>
  );

  return (
    <div className="@container/page flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} subtitle={subtitle} actions={actions} />

      {empty ? (
        <PageEmpty>
          Nothing in {project.name} yet. Start a session
          {newAgent && " or a background agent"} here.
        </PageEmpty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="grid items-start gap-x-4 px-2 pb-4 @3xl/page:grid-cols-[1.25fr_1fr] @3xl/page:px-6 @3xl/page:pt-4">
            <div className="min-w-0 @3xl/page:space-y-3">
              <NeedsYouSection
                waiting={waiting}
                blocked={blocked}
                titles={titles}
                looseWaiting={isMobile ? undefined : LOOSE_WAITING_WIDE}
                onOpenSession={onOpenSession}
              />
              <SessionsSection
                sessions={listed}
                projects={view.projects}
                statuses={statuses}
                titles={titles}
                activeSessionId={view.activeSession?.id}
                summarizingSessionId={mutations.summarizingSessionId}
                onOpenSession={onOpenSession}
                onOpenInTab={view.openSessionInNewTab}
                actions={mutations}
              />
              <AgentsSection agents={otherAgents} />
            </div>
            {/* Dev server then Changes in one column, as the closed Duo
                reads; Changes leads the right column when wide */}
            <div className="flex min-w-0 flex-col @3xl/page:gap-3">
              {!uncategorized && (
                <DevServerSection
                  project={project}
                  servers={servers}
                  onSetUp={() => view.handleStartDevServer(project.id)}
                  onRestart={mutations.handleRestartDevServer}
                  onStop={mutations.handleStopDevServer}
                  onRemove={mutations.handleRemoveDevServer}
                  className="@3xl/page:order-2"
                />
              )}
              <ChangesSection
                branch={git?.branch}
                files={files}
                onReview={review}
                className="@3xl/page:order-1"
              />
              {instructions && (
                <InstructionsSection
                  text={instructions}
                  onEdit={settings}
                  className="@3xl/page:order-3"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Narrow: the two ways to start, in reach of a thumb */}
      <div className="border-border flex shrink-0 gap-2 border-t px-3 pt-2.5 pb-3 md:hidden">
        <Button className="h-11 flex-1 rounded-xl" onClick={newSession}>
          <Plus />
          New session
        </Button>
        {newAgent && (
          <Button
            variant="secondary"
            className="h-11 flex-1 rounded-xl"
            onClick={newAgent}
          >
            <Bot />
            Background agent
          </Button>
        )}
      </div>

      <ActionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={project.name}
        description={home(project.working_directory)}
        groups={projectActionGroups(project, { ...handlers, onRename: rename })}
      />
    </div>
  );
}
