"use client";

import { useEffect, useMemo } from "react";
import { useSnapshot } from "valtio";
import { InboxDialog } from "@/components/Inbox";
import { SessionList } from "@/components/SessionList";
import { MissionControl } from "@/components/MissionControl";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { PaneLayout } from "@/components/PaneLayout";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";
import { fileOpenActions } from "@/stores/fileOpen";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { NavRail } from "@/components/mobile/NavRail";
import { useSideRail } from "@/hooks/useSideRail";
import { isNative } from "@/lib/native-bridge";
import { loadDuoPreview } from "@/stores/duoPreview";
import { cn } from "@/lib/utils";

export function MobileView({
  sessions,
  projects,
  sessionStatuses,
  sidebarOpen,
  setSidebarOpen,
  activeSession,
  focusedActiveTab,
  showNewSessionDialog,
  setShowNewSessionDialog,
  newSessionProjectId,
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
}: ViewProps) {
  // The iOS app puts this navigation in the system's own bar
  const railWidth = useSideRail(!isNative());

  useEffect(loadDuoPreview, []);

  useEffect(() => {
    mobileNavStore.statuses = sessionStatuses;
  }, [sessionStatuses]);

  useEffect(() => {
    mobileNavStore.railActive = railWidth > 0 || isNative();
  }, [railWidth]);

  const waitingSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          !s.conductor_session_id && sessionStatuses[s.id]?.status === "waiting"
      ),
    [sessions, sessionStatuses]
  );

  const { inboxOpen } = useSnapshot(mobileNavStore);
  const projectNames = useMemo(
    () =>
      Object.fromEntries(
        projects
          .filter((p) => p.name !== "Uncategorized")
          .map((p) => [p.id, p.name])
      ),
    [projects]
  );

  const sessionList = (
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
  );

  return (
    <main
      className="bg-background flex h-dvh flex-col overflow-hidden"
      style={railWidth ? { paddingRight: railWidth } : undefined}
    >
      {railWidth > 0 && (
        <NavRail
          columnWidth={railWidth}
          waitingCount={waitingSessions.length}
          onInbox={() => mobileNavActions.setInboxOpen(true)}
          onSessions={() => setSidebarOpen(!sidebarOpen)}
          onFind={() => setShowQuickSwitcher(true)}
          onNewSession={() => setShowNewSessionDialog(true)}
        />
      )}
      {/* The home: a page of its own rather than a drawer, the same in the
          app and a browser. The nav rail stays beside it */}
      {sidebarOpen && (
        <div
          className={cn(
            "bg-background fixed inset-0 z-40 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
            !railWidth && "pr-[env(safe-area-inset-right)]"
          )}
          style={railWidth ? { right: railWidth } : undefined}
        >
          <MissionControl
            sessions={sessions}
            sessionStatuses={sessionStatuses}
            projectNames={projectNames}
            activeSessionId={focusedActiveTab?.sessionId || undefined}
            onOpenSession={(session) => {
              attachToSession(session);
              setSidebarOpen(false);
            }}
            onNewSession={() => setShowNewSessionDialog(true)}
            projectsView={sessionList}
          />
        </div>
      )}

      {/* Terminal fills the screen */}
      <div className="min-h-0 w-full flex-1">
        <PaneLayout renderPane={renderPane} />
      </div>

      {/* Dialogs */}
      <InboxDialog
        open={inboxOpen}
        onOpenChange={mobileNavActions.setInboxOpen}
        waitingSessions={waitingSessions}
        projectNames={projectNames}
        onOpenSession={(session) => {
          attachToSession(session);
          mobileNavActions.requestViewMode("terminal");
        }}
      />
      <NewSessionDialog
        open={showNewSessionDialog}
        projects={projects}
        selectedProjectId={newSessionProjectId ?? undefined}
        onClose={() => setShowNewSessionDialog(false)}
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
