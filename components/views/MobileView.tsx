"use client";

import { cloneElement, useEffect, useMemo } from "react";
import { useSnapshot } from "valtio";
import { InboxDialog } from "@/components/Inbox";
import { SessionList } from "@/components/SessionList";
import { MissionControl } from "@/components/MissionControl";
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
import { isNative } from "@/lib/native-bridge";
import { useIsNative } from "@/hooks/useIsNative";
import { Switch } from "@/components/ui/switch";
import {
  duoPreviewStore,
  loadDuoPreview,
  setDuoPreview,
} from "@/stores/duoPreview";

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
  const native = useIsNative();

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
  const { on: duoPreview } = useSnapshot(duoPreviewStore);
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
          onSessions={() => setSidebarOpen(true)}
          onFind={() => setShowQuickSwitcher(true)}
          onNewSession={() => setShowNewSessionDialog(true)}
        />
      )}
      {native ? (
        // The app's home, a page of its own rather than a drawer
        sidebarOpen && (
          <div className="bg-background fixed inset-0 z-40 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
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
              glance={native && duoPreview}
              projectsView={
                <div className="flex h-full flex-col">
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {cloneElement(sessionList, { hideTitle: true })}
                  </div>
                  <div className="space-y-1 px-4 py-2">
                    <MinimaxUsageMonitor />
                    <TextSizeControl />
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">
                        Theme
                      </span>
                      <ThemeToggle />
                    </div>
                    <label className="flex min-h-[44px] items-center justify-between gap-3">
                      <span className="text-muted-foreground text-xs">
                        New closed-screen layout (trial)
                      </span>
                      <Switch
                        checked={duoPreview}
                        onCheckedChange={setDuoPreview}
                      />
                    </label>
                  </div>
                </div>
              }
            />
          </div>
        )
      ) : (
        <>
          {/* Swipe sidebar */}
          <SwipeSidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          >
            <div className="flex h-full flex-col">
              {/* Session list */}
              <div className="min-h-0 flex-1 overflow-hidden">
                {sessionList}
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
        </>
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
