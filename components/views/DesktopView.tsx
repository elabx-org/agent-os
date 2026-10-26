"use client";

import { useEffect, useMemo, useRef } from "react";
import { SessionList } from "@/components/SessionList";
import { ProjectList } from "@/components/Projects";
import { MissionControl } from "@/components/MissionControl";
import { NewSurfaceHost } from "@/components/New/NewSurface";
import { ProjectSettingsHost } from "@/components/Projects/ProjectSettingsDialog";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { PaneLayout } from "@/components/PaneLayout";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";
import { fileOpenActions } from "@/stores/fileOpen";
import { useSnapshot } from "valtio";
import { subscribeKey } from "valtio/utils";
import {
  NeedsYouDialog,
  useNeedsYouPage,
} from "@/components/Notifications/NeedsYouPage";
import { mobileNavStore } from "@/stores/mobileNav";
import { focusStore } from "@/stores/focus";
import { isNative } from "@/lib/native-bridge";
import { useIsNative } from "@/hooks/useIsNative";
import type { Session } from "@/lib/db";
import { SessionSpread } from "./SessionSpread";
import { WorkspacePage } from "@/components/WorkspacePage";
import { workspacePageStore } from "@/stores/workspacePage";

export function DesktopView(props: ViewProps) {
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
  const { page } = useSnapshot(workspacePageStore);
  const pageOpen = !!page;
  const native = useIsNative();
  // Needs you: a page across the open Duo, a dialog on the web
  useNeedsYouPage(native);

  // A page covers the pane, so the column selects no view
  useEffect(() => {
    mobileNavStore.homeOpen = pageOpen;
    return () => {
      mobileNavStore.homeOpen = false;
    };
  }, [pageOpen]);

  // Focus hides the home; back still brings it up, and it comes back with
  // Focus off if it was showing
  const sidebarOpenRef = useRef(sidebarOpen);
  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);
  useEffect(() => {
    let reopen = false;
    let unsubscribe = () => {};
    // Only toggles: loading the saved Focus at start isn't one (the start
    // state in app/page.tsx already allows for it)
    const timer = setTimeout(() => {
      unsubscribe = subscribeKey(focusStore, "on", (on) => {
        if (on) {
          reopen = sidebarOpenRef.current;
          setSidebarOpen(false);
        } else if (reopen) {
          reopen = false;
          setSidebarOpen(true);
        }
      });
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [setSidebarOpen]);

  useEffect(() => {
    mobileNavStore.statuses = sessionStatuses;
  }, [sessionStatuses]);
  const projectNames = useMemo(
    () =>
      Object.fromEntries(
        projects
          .filter((p) => p.name !== "Uncategorized")
          .map((p) => [p.id, p.name])
      ),
    [projects]
  );

  // On the open iPhone Duo the home is a page: opening a session leaves it
  // for the session and its rail
  const openFromHome = (session: Session) => {
    attachToSession(session);
    if (isNative()) setSidebarOpen(false);
  };

  // The Projects tab: a project opens its page beside the home; the old
  // tree stays one row away for managing sessions
  const projectList = (
    <ProjectList
      sessions={sessions}
      projects={projects}
      sessionStatuses={sessionStatuses}
      pills={!native}
      onNewSession={handleNewSessionInProject}
      onOpenTerminal={handleOpenTerminal}
      onStartDevServer={handleStartDevServer}
      allSessions={
        <SessionList
          activeSessionId={focusedActiveTab?.sessionId || undefined}
          sessionStatuses={sessionStatuses}
          onSelect={(id) => {
            const session = sessions.find((s) => s.id === id);
            if (session) openFromHome(session);
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
      }
    />
  );

  return (
    // Pad once here for system columns (the iPhone Duo inner display keeps one
    // on the right); --safe-right: 0 stops children padding for it again
    <div
      className="bg-background flex h-dvh overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
      style={{ "--safe-right": "0px" } as React.CSSProperties}
    >
      {/* The session header names the session and its back shows the home;
          New, Inbox, Find and Settings are in the control column */}
      <SessionSpread
        session={activeSession}
        projects={projects}
        homeOpen={sidebarOpen}
        pageSpread={page?.kind === "inbox"}
        page={
          pageOpen && (
            <WorkspacePage view={props} onOpenSession={openFromHome} />
          )
        }
        home={
          <MissionControl
            sessions={sessions}
            sessionStatuses={sessionStatuses}
            projectNames={projectNames}
            activeSessionId={focusedActiveTab?.sessionId || undefined}
            onOpenSession={openFromHome}
            projectsView={projectList}
          />
        }
      >
        <PaneLayout renderPane={renderPane} />
      </SessionSpread>

      {/* Dialogs */}
      {!native && (
        <NeedsYouDialog view={props} onOpenSession={attachToSession} />
      )}
      <NewSurfaceHost
        projects={projects}
        onCreated={handleSessionCreated}
        onCreateProject={handleCreateProject}
      />
      <ProjectSettingsHost />
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
