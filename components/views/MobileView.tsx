"use client";

import { useEffect, useMemo } from "react";
import { SessionList } from "@/components/SessionList";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TextSizeControl } from "@/components/TextSizeControl";
import { PaneLayout } from "@/components/PaneLayout";
import { SwipeSidebar } from "@/components/mobile/SwipeSidebar";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import { UsageMonitor } from "@/components/UsageMonitor";
import { MinimaxUsageMonitor } from "@/components/MinimaxUsageMonitor";
import type { ViewProps } from "./types";
import { fileOpenActions } from "@/stores/fileOpen";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { NavRail } from "@/components/mobile/NavRail";
import { useSideRail } from "@/hooks/useSideRail";

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
  const railWidth = useSideRail(true);

  useEffect(() => {
    mobileNavStore.statuses = sessionStatuses;
  }, [sessionStatuses]);

  useEffect(() => {
    mobileNavStore.railActive = railWidth > 0;
  }, [railWidth]);

  const waitingSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          !s.conductor_session_id && sessionStatuses[s.id]?.status === "waiting"
      ),
    [sessions, sessionStatuses]
  );

  // Jump to the next session waiting on you, cycling past the current one
  const openInbox = () => {
    if (waitingSessions.length === 0) {
      setSidebarOpen(true);
      return;
    }
    const currentId = focusedActiveTab?.sessionId;
    const at = waitingSessions.findIndex((s) => s.id === currentId);
    const next = waitingSessions[(at + 1) % waitingSessions.length];
    if (next.id !== currentId) attachToSession(next);
    mobileNavActions.requestViewMode("terminal");
  };

  return (
    <main
      className="bg-background flex h-dvh flex-col overflow-hidden"
      style={railWidth ? { paddingRight: railWidth } : undefined}
    >
      {railWidth > 0 && (
        <NavRail
          columnWidth={railWidth}
          waitingCount={waitingSessions.length}
          onInbox={openInbox}
          onSessions={() => setSidebarOpen(true)}
          onFind={() => setShowQuickSwitcher(true)}
          onNewSession={() => setShowNewSessionDialog(true)}
        />
      )}
      {/* Swipe sidebar */}
      <SwipeSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="flex h-full flex-col">
          {/* Session list */}
          <div className="min-h-0 flex-1 overflow-hidden">
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
          </div>

          {/* Sidebar footer */}
          <div className="mt-auto space-y-1 px-4 py-2">
            <UsageMonitor />
            <MinimaxUsageMonitor />
            <TextSizeControl />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </SwipeSidebar>

      {/* Terminal fills the screen */}
      <div className="min-h-0 w-full flex-1">
        <PaneLayout renderPane={renderPane} />
      </div>

      {/* Dialogs */}
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
