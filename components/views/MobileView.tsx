"use client";

import { useEffect, useMemo } from "react";
import { useSnapshot } from "valtio";
import { InboxDialog } from "@/components/Inbox";
import { SessionList } from "@/components/SessionList";
import { ProjectList } from "@/components/Projects";
import { MissionControl } from "@/components/MissionControl";
import { NewSurfaceHost } from "@/components/New/NewSurface";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { PaneLayout } from "@/components/PaneLayout";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";
import { fileOpenActions } from "@/stores/fileOpen";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { ControlColumn } from "@/components/ControlColumn";
import { useSideRail } from "@/hooks/useSideRail";
import { isNative } from "@/lib/native-bridge";
import { loadDuoPreview } from "@/stores/duoPreview";
import { cn } from "@/lib/utils";
import { WorkspacePage } from "@/components/WorkspacePage";
import { workspacePageStore } from "@/stores/workspacePage";

export function MobileView(props: ViewProps) {
  const {
    sessions,
    projects,
    sessionStatuses,
    sidebarOpen,
    setSidebarOpen,
    activeSession,
    focusedActiveTab,
    showQuickSwitcher,
    setShowQuickSwitcher,
    attachToSession,
    openSessionInNewTab,
    handleNewSessionInProject,
    handleOpenTerminal,
    handleSessionCreated,
    handleCreateProject,
    handleStartDevServer,
    handleCreateDevServer,
    startDevServerProject,
    setStartDevServerProjectId,
    renderPane,
  } = props;
  // The iOS app puts this navigation in the system's own bar
  const railWidth = useSideRail(!isNative());
  // A phone in a browser has no system column, so the column is a bottom bar
  const showBar = !railWidth && !isNative();

  useEffect(loadDuoPreview, []);

  useEffect(() => {
    mobileNavStore.statuses = sessionStatuses;
  }, [sessionStatuses]);

  useEffect(() => {
    // The column, the bar or the iOS app's own bar is always showing here
    mobileNavStore.railActive = true;
    mobileNavStore.railWidth = railWidth;
    return () => {
      mobileNavStore.railWidth = 0;
    };
  }, [railWidth]);

  const waitingSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          !s.conductor_session_id && sessionStatuses[s.id]?.status === "waiting"
      ),
    [sessions, sessionStatuses]
  );

  const { page } = useSnapshot(workspacePageStore);
  const pageOpen = !!page;

  // A page covers the pane too
  useEffect(() => {
    mobileNavStore.homeOpen = sidebarOpen || pageOpen;
    return () => {
      mobileNavStore.homeOpen = false;
    };
  }, [sidebarOpen, pageOpen]);

  const { inboxOpen, request: viewRequest } = useSnapshot(mobileNavStore);
  // Picking a view in the column or bar leaves the home for the session
  const hasSession = !!focusedActiveTab?.sessionId;
  useEffect(() => {
    if (viewRequest && hasSession) setSidebarOpen(false);
  }, [viewRequest, hasSession, setSidebarOpen]);
  const projectNames = useMemo(
    () =>
      Object.fromEntries(
        projects
          .filter((p) => p.name !== "Uncategorized")
          .map((p) => [p.id, p.name])
      ),
    [projects]
  );

  // The Projects tab: a project opens its page over the home; the old tree
  // stays one row away for managing sessions
  const projectList = (
    <ProjectList
      sessions={sessions}
      projects={projects}
      sessionStatuses={sessionStatuses}
      onNewSession={handleNewSessionInProject}
      onOpenTerminal={handleOpenTerminal}
      onStartDevServer={handleStartDevServer}
      allSessions={
        <SessionList
          activeSessionId={focusedActiveTab?.sessionId || undefined}
          sessionStatuses={sessionStatuses}
          onSelect={(id) => {
            const session = sessions.find((s) => s.id === id);
            if (session) attachToSession(session);
            setSidebarOpen(false);
          }}
          onOpenInTab={(id) => {
            const session = sessions.find((s) => s.id === id);
            if (session) openSessionInNewTab(session);
            setSidebarOpen(false);
          }}
          onNewSessionInProject={handleNewSessionInProject}
          onOpenTerminal={handleOpenTerminal}
          onStartDevServer={handleStartDevServer}
          onCreateDevServer={handleCreateDevServer}
        />
      }
    />
  );

  // The home and pages: a full screen beside the column or above the bar
  const layerClass = cn(
    "bg-background fixed inset-0 z-40 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]",
    !railWidth && "pr-[env(safe-area-inset-right)]",
    !showBar && "pb-[env(safe-area-inset-bottom)]"
  );
  const layerStyle = railWidth
    ? { right: railWidth }
    : showBar
      ? { bottom: "var(--control-bar-h, 0px)" }
      : undefined;

  return (
    <main
      className="bg-background flex h-dvh flex-col overflow-hidden"
      style={railWidth ? { paddingRight: railWidth } : undefined}
    >
      {railWidth > 0 && (
        <ControlColumn variant="column" sideRailWidth={railWidth} />
      )}
      {/* The home: a page of its own rather than a drawer, the same in the
          app and a browser. The column or bar stays beside it */}
      {sidebarOpen && (
        <div className={layerClass} style={layerStyle}>
          <MissionControl
            sessions={sessions}
            sessionStatuses={sessionStatuses}
            projectNames={projectNames}
            activeSessionId={focusedActiveTab?.sessionId || undefined}
            onOpenSession={(session) => {
              attachToSession(session);
              setSidebarOpen(false);
            }}
            // New and the way back are in the column, the bar or the
            // iOS app's own bar
            projectsView={projectList}
          />
        </div>
      )}

      {/* A workspace page: over the home it was opened from, so back
          shows the home again */}
      {pageOpen && (
        <div className={layerClass} style={layerStyle}>
          <WorkspacePage
            view={props}
            onOpenSession={(session) => {
              attachToSession(session);
              setSidebarOpen(false);
            }}
          />
        </div>
      )}

      {/* Terminal fills the screen; out of reach while a page covers it */}
      <div className="min-h-0 w-full flex-1" inert={pageOpen}>
        <PaneLayout renderPane={renderPane} />
      </div>
      {showBar && <ControlColumn variant="bar" />}

      {/* Dialogs */}
      <InboxDialog
        open={inboxOpen}
        onOpenChange={mobileNavActions.setInboxOpen}
        waitingSessions={waitingSessions}
        projectNames={projectNames}
        onOpenSession={(session) => {
          attachToSession(session);
          mobileNavActions.requestViewMode("terminal");
          setSidebarOpen(false);
        }}
      />
      <NewSurfaceHost
        projects={projects}
        onCreated={handleSessionCreated}
        onCreateProject={handleCreateProject}
      />
      <QuickSwitcher
        sessions={sessions}
        open={showQuickSwitcher}
        onOpenChange={setShowQuickSwitcher}
        currentSessionId={focusedActiveTab?.sessionId ?? undefined}
        activeSessionWorkingDir={activeSession?.working_directory ?? undefined}
        onSelectSession={(sessionId) => {
          const session = sessions.find((s) => s.id === sessionId);
          if (session) attachToSession(session);
          setSidebarOpen(false);
        }}
        onSelectFile={(file, line) => {
          // Convert relative path to absolute by prepending working directory
          const absolutePath = activeSession?.working_directory
            ? `${activeSession.working_directory}/${file.replace(/^\.\//, "")}`
            : file;
          fileOpenActions.requestOpen(absolutePath, line);
        }}
      />
      {startDevServerProject && (
        <StartServerDialog
          project={startDevServerProject}
          projectDevServers={startDevServerProject.devServers}
          onStart={handleCreateDevServer}
          onClose={() => setStartDevServerProjectId(null)}
        />
      )}
    </main>
  );
}
