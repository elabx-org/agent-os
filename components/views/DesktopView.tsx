"use client";

import { cn } from "@/lib/utils";
import { useEffect, useMemo } from "react";
import { SessionList } from "@/components/SessionList";
import { MissionControl } from "@/components/MissionControl";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { NotificationSettings } from "@/components/NotificationSettings";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TextSizeControl } from "@/components/TextSizeControl";
import { Button } from "@/components/ui/button";
import {
  PanelLeftClose,
  PanelLeft,
  Plus,
  Copy,
  Check,
  Command,
  Inbox,
} from "lucide-react";
import { PaneLayout } from "@/components/PaneLayout";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import { UsageMonitor } from "@/components/UsageMonitor";
import { MinimaxUsageMonitor } from "@/components/MinimaxUsageMonitor";
import type { ViewProps } from "./types";
import { fileOpenActions } from "@/stores/fileOpen";
import { useSnapshot } from "valtio";
import { InboxDialog } from "@/components/Inbox";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { useIsNative } from "@/hooks/useIsNative";
import { postureStore } from "@/stores/posture";

export function DesktopView({
  sessions,
  projects,
  sessionStatuses,
  sidebarOpen,
  setSidebarOpen,
  activeSession,
  focusedActiveTab,
  copiedSessionId,
  setCopiedSessionId,
  showNewSessionDialog,
  setShowNewSessionDialog,
  newSessionProjectId,
  showNotificationSettings,
  setShowNotificationSettings,
  showQuickSwitcher,
  setShowQuickSwitcher,
  notificationSettings,
  permissionGranted,
  updateSettings,
  requestPermission,
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
  const { inboxOpen } = useSnapshot(mobileNavStore);
  // The iOS app has this header's actions in the system bar
  const native = useIsNative();
  // Half open like a book: the list is the left page and the session the
  // right, with nothing in the fold between them
  const { fold } = useSnapshot(postureStore);
  const book = fold?.axis === "vertical" ? fold : null;

  useEffect(() => {
    mobileNavStore.statuses = sessionStatuses;
  }, [sessionStatuses]);
  const waitingSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          !s.conductor_session_id && sessionStatuses[s.id]?.status === "waiting"
      ),
    [sessions, sessionStatuses]
  );
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
      }}
      onOpenInTab={(id) => {
        const session = sessions.find((s) => s.id === id);
        if (session) openSessionInNewTab(session);
      }}
      onNewSessionInProject={handleNewSessionInProject}
      onOpenTerminal={handleOpenTerminal}
      onStartDevServer={handleStartDevServer}
      onCreateDevServer={handleCreateDevServer}
    />
  );

  return (
    // Pad once here for system columns (the iPhone Duo inner display keeps one
    // on the right); --safe-right: 0 stops children padding for it again
    <div
      className="bg-background flex h-dvh overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
      style={{ "--safe-right": "0px" } as React.CSSProperties}
    >
      {/* Desktop Sidebar */}
      <div
        className={cn(
          "kb-compact-hide bg-sidebar-background flex-shrink-0 overflow-hidden shadow-xl shadow-black/10 transition-all duration-200 dark:shadow-black/30",
          book
            ? ""
            : sidebarOpen
              ? native
                ? "border-border w-1/2 border-r"
                : "w-60"
              : "w-0"
        )}
        style={
          book
            ? { width: `calc(${book.start}px - env(safe-area-inset-left))` }
            : undefined
        }
      >
        <div className="flex h-full flex-col">
          {/* Session list */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {native ? (
              // In the app, the left page of the open display: mission control
              <MissionControl
                sessions={sessions}
                sessionStatuses={sessionStatuses}
                projectNames={projectNames}
                activeSessionId={focusedActiveTab?.sessionId || undefined}
                onOpenSession={attachToSession}
                onNewSession={() => setShowNewSessionDialog(true)}
                projectsView={sessionList}
              />
            ) : (
              sessionList
            )}
          </div>

          {/* Sidebar footer with theme toggle; usage moves here when the header is narrow */}
          <div className="mt-auto space-y-1 px-3 py-1.5">
            <div className={cn("space-y-1 xl:hidden", native && "hidden")}>
              <UsageMonitor />
              <MinimaxUsageMonitor />
            </div>
            <TextSizeControl />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      {book && (
        <div
          aria-hidden="true"
          className="bg-background kb-compact-hide flex-shrink-0"
          style={{ width: book.end - book.start }}
        />
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header
          className={cn(
            "kb-compact-hide flex items-center justify-between gap-2 px-4 py-2",
            native && "hidden"
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>

            {activeSession && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium whitespace-nowrap">
                  {activeSession.name}
                </span>
                {activeSession.tmux_name && (
                  <span className="text-muted-foreground hidden truncate text-xs whitespace-nowrap xl:inline">
                    {activeSession.tmux_name}
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6"
                      onClick={async () => {
                        try {
                          if (navigator.clipboard) {
                            await navigator.clipboard.writeText(
                              activeSession.id
                            );
                          } else {
                            // Fallback for non-HTTPS contexts
                            const textarea = document.createElement("textarea");
                            textarea.value = activeSession.id;
                            textarea.style.position = "fixed";
                            textarea.style.opacity = "0";
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand("copy");
                            document.body.removeChild(textarea);
                          }
                          setCopiedSessionId(true);
                          setTimeout(() => setCopiedSessionId(false), 2000);
                        } catch {
                          console.error("Failed to copy to clipboard");
                        }
                      }}
                    >
                      {copiedSessionId ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copy session ID for orchestration</p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {activeSession.id.slice(0, 8)}...
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {waitingSessions.length > 0 && (
              <button
                type="button"
                onClick={() => mobileNavActions.setInboxOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-full bg-amber-400/15 px-3 text-xs font-semibold text-amber-400 hover:bg-amber-400/25"
                aria-label={`Inbox, ${waitingSessions.length} waiting`}
              >
                <Inbox className="h-4 w-4" />
                {waitingSessions.length}
              </button>
            )}
            <div className="hidden items-center gap-2 xl:flex">
              <UsageMonitor />
              <MinimaxUsageMonitor />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowQuickSwitcher(true)}
                >
                  <Command className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Quick switch</p>
                <p className="text-muted-foreground text-xs">⌘K</p>
              </TooltipContent>
            </Tooltip>
            <NotificationSettings
              open={showNotificationSettings}
              onOpenChange={setShowNotificationSettings}
              settings={notificationSettings}
              permissionGranted={permissionGranted}
              waitingSessions={sessions
                .filter((s) => sessionStatuses[s.id]?.status === "waiting")
                .map((s) => ({ id: s.id, name: s.name }))}
              onUpdateSettings={updateSettings}
              onRequestPermission={requestPermission}
              onSelectSession={(id) => {
                const session = sessions.find((s) => s.id === id);
                if (session) attachToSession(session);
              }}
            />
            <Button
              size="sm"
              onClick={() => setShowNewSessionDialog(true)}
              aria-label="New session"
            >
              <Plus className="h-4 w-4 lg:mr-1" />
              <span className="hidden lg:inline">New Session</span>
            </Button>
          </div>
        </header>

        {/* Pane Layout - full height */}
        <div className="min-h-0 flex-1">
          <PaneLayout renderPane={renderPane} />
        </div>
      </div>

      {/* Dialogs */}
      <InboxDialog
        open={inboxOpen}
        onOpenChange={mobileNavActions.setInboxOpen}
        waitingSessions={waitingSessions}
        projectNames={projectNames}
        onOpenSession={attachToSession}
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
    </div>
  );
}
