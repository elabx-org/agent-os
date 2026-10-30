"use client";

import { useEffect, useMemo, useRef } from "react";
import { SessionList } from "@/components/SessionList";
import { ProjectList } from "@/components/Projects";
import { MissionControl } from "@/components/MissionControl";
import { NewSurfaceHost } from "@/components/New/NewSurface";
import { ProjectSettingsHost } from "@/components/Projects/ProjectSettingsDialog";
import { StartServerDialog } from "@/components/DevServers/StartServerDialog";
import { PaneLayout } from "@/components/PaneLayout";
import { SearchHost } from "@/components/Search/SearchHost";
import type { ViewProps } from "./types";
import { fileOpenActions } from "@/stores/fileOpen";
import { useSnapshot } from "valtio";
import { subscribeKey } from "valtio/utils";
import {
  NeedsYouDialog,
  useNeedsYouPage,
} from "@/components/Notifications/NeedsYouPage";
import { mobileNavStore } from "@/stores/mobileNav";
import { diffReviewStore } from "@/stores/diffReview";
import { focusStore } from "@/stores/focus";
import { isNative } from "@/lib/native-bridge";
import { useRunningFlag } from "@/hooks/useRunningFlag";
import { useIsNative } from "@/hooks/useIsNative";
import type { Session } from "@/lib/db";
import { besidePills, SessionSpread } from "./SessionSpread";
import { WorkspacePage } from "@/components/WorkspacePage";
import { closePage, workspacePageStore } from "@/stores/workspacePage";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { usePanes } from "@/contexts/PaneContext";
import { getAllPaneIds } from "@/lib/panes";
import { runNav } from "@/lib/nav-actions";
import {
  AVATAR_RAIL_WIDTH,
  AvatarRail,
  DESKTOP_PROJECTS_WIDTH,
  DESKTOP_SIDEBAR_WIDTH,
  DesktopSidebar,
  SessionPill,
} from "@/components/Sidebar";

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
  // The desktop shell: gated on the posture, never on width (the open Duo
  // in a browser is as wide and keeps its column and Now)
  const desktop = useLayoutMode() === "desktop" && !native;
  const { homeTab } = useSnapshot(mobileNavStore);
  const { state: paneState, focusPane, getActiveTab } = usePanes();
  const paneIds = getAllPaneIds(paneState.layout);
  const paneSessions = paneIds.map((id) => getActiveTab(id)?.sessionId ?? null);
  const shownIds = paneSessions.filter((id): id is string => !!id);
  // Panes on a plain shell tab: the rail shows them too (Desk-Beside's >_)
  const shells = paneIds.flatMap((paneId) => {
    const tab = getActiveTab(paneId);
    return tab && !tab.sessionId && tab.attachedTmux
      ? [{ paneId, name: tab.attachedTmux }]
      : [];
  });
  // Needs you: a page across the open Duo, a dialog on the web
  useNeedsYouPage(!desktop);
  useRunningFlag();

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

  // Already in a pane, it takes focus there; else it opens in the focused one
  const openOnDesktop = (session: Session) => {
    const showing = paneIds[paneSessions.indexOf(session.id)];
    if (!showing) return attachToSession(session);
    closePage();
    focusPane(showing);
  };

  // Open-Beside: each page's pill picks what that page shows
  const pickFor = (paneId: string) => () => {
    focusPane(paneId);
    setShowQuickSwitcher(true);
  };
  const paneTop = (paneId: string) => {
    const id = paneSessions[paneIds.indexOf(paneId)];
    const session = id ? sessions.find((s) => s.id === id) : undefined;
    return (
      session &&
      besidePills() && (
        <SessionPill
          session={session}
          status={sessionStatuses[session.id]}
          onPick={pickFor(paneId)}
        />
      )
    );
  };

  // Two or more panes on the desktop: the sidebar steps down to the rail
  // and the panes become cards (Desk-Beside)
  const beside = desktop && paneIds.length > 1;
  // A turn's diff review beside the chat steps it down too (D-Diff)
  const { open: review } = useSnapshot(diffReviewStore);
  const reviewing =
    desktop && !!review && review.sessionId === activeSession?.id;
  const projectsShown = desktop && homeTab === "projects";
  const rail = (beside || reviewing) && !pageOpen && !projectsShown;
  const homeWidth = !desktop
    ? undefined
    : rail
      ? AVATAR_RAIL_WIDTH
      : projectsShown
        ? DESKTOP_PROJECTS_WIDTH
        : DESKTOP_SIDEBAR_WIDTH;
  // New's desktop layer (portalled to body) starts where the home ends
  useEffect(() => {
    const root = document.documentElement.style;
    if (homeWidth === undefined) return;
    root.setProperty("--desktop-home-w", `${sidebarOpen ? homeWidth : 0}px`);
    return () => {
      root.removeProperty("--desktop-home-w");
    };
  }, [homeWidth, sidebarOpen]);

  // The Projects tab: a project opens its page beside the home; the old
  // tree stays one row away for managing sessions
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
        homeWidth={homeWidth}
        pageSpread={page?.kind === "inbox" || page?.kind === "running"}
        page={
          pageOpen && (
            <WorkspacePage view={props} onOpenSession={openFromHome} />
          )
        }
        home={
          !desktop ? (
            <MissionControl
              sessions={sessions}
              sessionStatuses={sessionStatuses}
              projectNames={projectNames}
              activeSessionId={focusedActiveTab?.sessionId || undefined}
              onOpenSession={openFromHome}
              projectsView={projectList}
            />
          ) : rail ? (
            <AvatarRail
              sessions={sessions}
              sessionStatuses={sessionStatuses}
              shownIds={shownIds}
              shells={shells}
              onOpenSession={openOnDesktop}
              onFocusPane={focusPane}
              onNewSession={() => runNav("new")}
            />
          ) : (
            <DesktopSidebar
              view={props}
              activeSessionId={focusedActiveTab?.sessionId || undefined}
              onOpenSession={openOnDesktop}
              projectsView={projectList}
            />
          )
        }
      >
        <PaneLayout renderPane={renderPane} paneTop={paneTop} cards={beside} />
      </SessionSpread>

      {/* Dialogs */}
      {desktop && (
        <NeedsYouDialog view={props} onOpenSession={attachToSession} />
      )}
      <NewSurfaceHost
        projects={projects}
        onCreated={handleSessionCreated}
        onCreateProject={handleCreateProject}
      />
      <ProjectSettingsHost />
      <SearchHost
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
          // Search results pass absolute paths; others are relative to the session folder
          const absolutePath = file.startsWith("/")
            ? file
            : activeSession?.working_directory
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
