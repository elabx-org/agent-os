"use client";

import { useRef, useCallback, useEffect, memo, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePanes } from "@/contexts/PaneContext";
import { useViewport } from "@/hooks/useViewport";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import type {
  TerminalHandle,
  TerminalScrollState,
} from "@/components/Terminal";
import type { Session, Project } from "@/lib/db";
import { sessionRegistry } from "@/lib/client/session-registry";
import { cn } from "@/lib/utils";
import { AgentsView } from "@/components/Session/AgentsView";
import { useAgentCount } from "@/components/Session/agent-tree-count";
import { canonicalViewMode } from "@/lib/agent-views";
import { useFileEditor } from "@/hooks/useFileEditor";
import { SessionTitleBar } from "./SessionTitleBar";
import { DesktopTabBar } from "./DesktopTabBar";
import {
  TerminalSkeleton,
  FileExplorerSkeleton,
  GitPanelSkeleton,
} from "./PaneSkeletons";
import {
  Panel as ResizablePanel,
  Group as ResizablePanelGroup,
  Separator as ResizablePanelHandle,
} from "react-resizable-panels";
import { ShellDrawer } from "@/components/ShellDrawer";
import { useSnapshot } from "valtio";
import { fileOpenStore, fileOpenActions } from "@/stores/fileOpen";
import {
  mobileNavStore,
  mobileNavActions,
  type PaneViewMode,
} from "@/stores/mobileNav";
import { focusStore } from "@/stores/focus";
import {
  getSessionView,
  openingView,
  setSessionView,
} from "@/lib/session-views";
import { useFlag } from "@/hooks/useFlags";
import { usePaneChrome } from "@/components/Session/usePaneChrome";
import { takePaneLaunch } from "@/stores/beside";
import { isPaused } from "@/lib/handoff-types";
import { ActivityStrip } from "@/components/Session/ActivityStrip";
import { isNative } from "@/lib/native-bridge";
import { useSharedFiles } from "@/hooks/useSharedFiles";
import { useGitStatus } from "@/data/git/queries";
import { useTerminalRunRequest } from "@/stores/scriptTerminal";

// Dynamic imports for client-only components with loading states
const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false, loading: () => <TerminalSkeleton /> }
);

const FileExplorer = dynamic(
  () => import("@/components/FileExplorer").then((mod) => mod.FileExplorer),
  { ssr: false, loading: () => <FileExplorerSkeleton /> }
);

const ChatView = dynamic(
  () => import("@/components/ChatView").then((mod) => mod.ChatView),
  { ssr: false }
);

const GitPanel = dynamic(
  () => import("@/components/GitPanel").then((mod) => mod.GitPanel),
  { ssr: false, loading: () => <GitPanelSkeleton /> }
);

interface PaneProps {
  paneId: string;
  sessions: Session[];
  projects: Project[];
  onRegisterTerminal: (
    paneId: string,
    tabId: string,
    ref: TerminalHandle | null
  ) => void;
  onSelectSession?: (sessionId: string) => void;
}

type ViewMode = PaneViewMode;


/** Each pane's view and session, by pane id */
const paneViewModes = new Map<string, ViewMode>();
const paneSessions = new Map<string, string | undefined>();
export const Pane = memo(function Pane({
  paneId,
  sessions,
  projects,
  onRegisterTerminal,
  onSelectSession,
}: PaneProps) {
  const { isMobile } = useViewport();
  const layoutMode = useLayoutMode();
  const {
    focusedPaneId,
    canSplit,
    canClose,
    focusPane,
    paneCount,
    splitHorizontal,
    splitVertical,
    close,
    getPaneData,
    getActiveTab,
    addTab,
    closeTab,
    switchTab,
    attachSession,
    detachSession,
  } = usePanes();

  // Kept across remounts: folding an iPhone Duo swaps the layout around the
  // pane, and the view you were reading should still be there
  const [viewMode, setViewModeState] = useState<ViewMode>(
    () => paneViewModes.get(paneId) ?? "terminal"
  );
  const setViewMode = useCallback(
    (next: ViewMode | ((mode: ViewMode) => ViewMode)) =>
      setViewModeState((mode) => {
        const value = canonicalViewMode(
          typeof next === "function" ? next(mode) : next
        );
        paneViewModes.set(paneId, value);
        return value;
      }),
    [paneId]
  );
  const [gitDrawerOpen, setGitDrawerOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    // The iOS app shows changes as a view instead
    if (isNative()) return false;
    const stored = localStorage.getItem("gitDrawerOpen");
    // Default closed where it would squeeze the terminal beside the live
    // activity rail
    return stored === null ? window.innerWidth >= 1600 : stored === "true";
  });
  const [shellDrawerOpen, setShellDrawerOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("shellDrawerOpen");
    return stored === "true";
  });
  const terminalRefs = useRef<Map<string, TerminalHandle | null>>(new Map());
  const initializedTabs = useRef<Set<string>>(new Set());
  const paneData = getPaneData(paneId);
  const activeTab = getActiveTab(paneId);

  // Get ref for active terminal
  const terminalRef = activeTab
    ? (terminalRefs.current.get(activeTab.id) ?? null)
    : null;
  const isFocused = focusedPaneId === paneId;
  // Files shared to the iOS app attach to the focused session
  useSharedFiles(terminalRef, isFocused);
  const session = activeTab
    ? sessions.find((s) => s.id === activeTab.sessionId)
    : null;
  // Handed off (M4): no terminal to attach or launch, its chat stays
  const sessionPaused = isPaused(session);
  // M3: a script for this session's shell drawer opens it
  const terminalRun = useTerminalRunRequest(session?.id);
  useEffect(() => {
    if (terminalRun) setShellDrawerOpen(true);
  }, [terminalRun]);

  // File editor state - lifted here so it persists across view switches
  const fileEditor = useFileEditor();

  // Its agents (the agents view; the column's Agents item and the ⋯)
  const agentCount = useAgentCount({
    session,
    sessions,
    isFocused,
    agentsShown: viewMode === "agents",
  });

  // Get current project and its repositories
  const currentProject = useMemo(() => {
    if (!session?.project_id) return null;
    return projects.find((p) => p.id === session.project_id) || null;
  }, [session?.project_id, projects]);

  // Type assertion for repositories (projects passed here should have repositories)
  const projectRepositories = useMemo(() => {
    if (!currentProject) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (currentProject as any).repositories || [];
  }, [currentProject]);

  // Watch for file open requests
  const { request: fileOpenRequest } = useSnapshot(fileOpenStore);

  // The activity strip says what the session is doing, unless the rail
  // beside the pane already does, Focus hides both, or the view on the fold
  // deck shows its own state line
  const { railShown } = useSnapshot(mobileNavStore);
  const { on: focusOn } = useSnapshot(focusStore);
  const [deckShown, setDeckShown] = useState(false);
  // The column's Stop and working state; a header that says the activity
  const chrome = usePaneChrome({ session, isFocused, paneCount });
  const showStrip =
    !!session &&
    (viewMode === "chat" || viewMode === "terminal") &&
    !focusOn &&
    !railShown &&
    !deckShown &&
    !chrome.headerHasActivity;
  // The strip or the rail (beside the focused pane) lists its agents already
  const agentsShown = showStrip || (railShown && isFocused);

  // Reset view mode and file editor when session changes
  const chatDefault = useFlag("chatDefault");
  // The view a session opened in by default: not one you chose, so not
  // remembered until you change it
  const defaultedRef = useRef<ViewMode | null>(null);
  useEffect(() => {
    // A remount (folding) shows the same session: keep its view
    const previous = paneSessions.get(paneId);
    paneSessions.set(paneId, session?.id);
    if (previous === session?.id) return;
    // Each session opens in the view you last used there, else chat for
    // Claude (flag chatDefault) or the terminal
    const next = session
      ? isPaused(session)
        ? "chat"
        : openingView(session.id, session.agent_type, chatDefault)
      : "terminal";
    defaultedRef.current = next;
    setViewMode(next);
    fileEditor.reset();
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The flags load after the first render: a session opened before they
  // did, still in the terminal it got by default, opens its chat then
  useEffect(() => {
    if (!chatDefault || !session || getSessionView(session.id)) return;
    const next = openingView(session.id, session.agent_type, true);
    if (next === viewMode || viewMode !== "terminal") return;
    defaultedRef.current = next;
    setViewMode(next);
  }, [chatDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened in chat by default, but nothing has been said yet: the terminal
  // is where there's something to see
  const chatEmpty = useCallback(() => {
    if (defaultedRef.current !== "chat" || sessionPaused) return;
    defaultedRef.current = "terminal";
    setViewMode((mode) => (mode === "chat" ? "terminal" : mode));
  }, [setViewMode, sessionPaused]);

  // Handed off while showing here: its terminal ended, its chat stays
  const wasPaused = useRef(sessionPaused);
  useEffect(() => {
    if (sessionPaused && !wasPaused.current) {
      defaultedRef.current = "chat";
      setViewMode((mode) => (mode === "terminal" ? "chat" : mode));
    }
    wasPaused.current = sessionPaused;
  }, [sessionPaused, setViewMode]);

  // Remember a change of view; a switch of session alone isn't one
  const viewSessionId = useRef(session?.id);
  viewSessionId.current = session?.id;
  const viewMounted = useRef(false);
  useEffect(() => {
    const id = viewSessionId.current;
    // Nor is the view a pane mounts with, or the one it opened in
    if (!viewMounted.current) {
      viewMounted.current = true;
      return;
    }
    if (viewMode === defaultedRef.current) return;
    defaultedRef.current = null;
    if (id && (viewMode === "terminal" || viewMode === "chat"))
      setSessionView(id, viewMode);
  }, [viewMode]);

  // Persist drawer states
  useEffect(() => {
    localStorage.setItem("gitDrawerOpen", String(gitDrawerOpen));
  }, [gitDrawerOpen]);

  useEffect(() => {
    localStorage.setItem("shellDrawerOpen", String(shellDrawerOpen));
  }, [shellDrawerOpen]);

  // Handle file open requests (only if this pane is focused)
  useEffect(() => {
    if (fileOpenRequest && isFocused && session) {
      // Switch to files view
      setViewMode("files");
      // Open the file
      fileEditor.openFile(fileOpenRequest.path);
      // Clear the request
      fileOpenActions.clearRequest();
      // TODO: Scroll to line (requires FileEditor enhancement)
    }
  }, [fileOpenRequest, isFocused, session, fileEditor]);

  // Mobile nav rail: mirror the focused pane's view and take view requests
  const { request: navRequest } = useSnapshot(mobileNavStore);

  useEffect(() => {
    if (!isFocused) return;
    mobileNavStore.viewMode = viewMode;
    // Where the closed column's "Back to session" returns from Changes or Files
    if (viewMode === "chat" || viewMode === "terminal")
      mobileNavStore.conversationView = viewMode;
  }, [isFocused, viewMode]);

  // The column badges Changes with the focused session's changed files
  const { data: gitStatus } = useGitStatus(session?.working_directory ?? "", {
    enabled: isFocused,
  });
  useEffect(() => {
    if (!isFocused) return;
    mobileNavStore.changes = gitStatus
      ? new Set(
          [...gitStatus.staged, ...gitStatus.unstaged, ...gitStatus.untracked].map(
            (f) => f.path
          )
        ).size
      : 0;
  }, [isFocused, gitStatus]);

  useEffect(() => {
    if (!navRequest || !isFocused) return;
    // Asked for a session that's still attaching: wait until it's this one's,
    // but not for ever, nor apply it once it's that old
    if (navRequest.sessionId) {
      if (Date.now() - navRequest.timestamp > 10_000) {
        mobileNavActions.clearRequest();
        return;
      }
      if (navRequest.sessionId !== session?.id) return;
    }
    if (navRequest.mode === "terminal" || session?.working_directory) {
      // Asked for, so not a default an empty chat swaps for the terminal
      defaultedRef.current = null;
      setViewMode(navRequest.mode);
    }
    mobileNavActions.clearRequest();
  }, [
    navRequest,
    isFocused,
    session?.id,
    session?.working_directory,
  ]);

  // Not twice: Changes as the view takes the drawer's place
  const showGitDrawer = gitDrawerOpen && viewMode !== "git";

  const handleFocus = useCallback(() => {
    focusPane(paneId);
  }, [focusPane, paneId]);

  const handleDetach = useCallback(() => {
    if (terminalRef) {
      terminalRef.sendInput("\x02d"); // Ctrl+B d to detach
    }
    detachSession(paneId);
  }, [detachSession, paneId, terminalRef]);

  // Create ref callback for a specific tab
  const getTerminalRef = useCallback(
    (tabId: string) => (handle: TerminalHandle | null) => {
      if (handle) {
        terminalRefs.current.set(tabId, handle);
      } else {
        terminalRefs.current.delete(tabId);
        initializedTabs.current.delete(tabId);
      }
    },
    []
  );

  // Tmux setup commands shared across all attach points
  const tmuxSetup = [
    `tmux set-option -g mouse on`,
    `tmux set-option -sg escape-time 10`,
    // The most recently active client sets the width, so a phone and a
    // desktop on one session each get a window that wraps at their screen
    `tmux set-option -g window-size latest`,
    `tmux set-window-option -g aggressive-resize on`,
    // Scroll 5 lines per wheel event instead of 1 for smoother scrolling
    `tmux bind-key -T copy-mode WheelUpPane send-keys -X -N 5 scroll-up`,
    `tmux bind-key -T copy-mode WheelDownPane send-keys -X -N 5 scroll-down`,
    `tmux bind-key -T copy-mode-vi WheelUpPane send-keys -X -N 5 scroll-up`,
    `tmux bind-key -T copy-mode-vi WheelDownPane send-keys -X -N 5 scroll-down`,
    // Tmux menu
    `tmux bind-key m display-menu -T "Tmux" -x R -y P "Copy Mode" c copy-mode "Paste Buffer" p paste-buffer "" "" "" "Split Horizontal" h 'split-window -h' "Split Vertical" v 'split-window -v'`,
  ].map(c => `${c} 2>/dev/null`).join("; ") +
    // Wipe the echoed setup line (screen and scrollback) before attaching.
    // Not tmux clear-history: that would drop the session's own history.
    `; printf '\\033[H\\033[2J\\033[3J'`;

  // Create onConnected callback for a specific tab
  const getTerminalConnectedHandler = useCallback(
    (tab: (typeof paneData.tabs)[0]) => (info?: { replacedPty: boolean }) => {
      console.log(
        `[AgentOS] Terminal connected for pane: ${paneId}, tab: ${tab.id}`
      );
      const handle = terminalRefs.current.get(tab.id);
      if (!handle) return;

      onRegisterTerminal(paneId, tab.id, handle);

      // Skip tmux command on WebSocket reconnect — PTY is still alive with tmux running.
      // A replaced PTY (old one expired or server restarted) is a bare shell: re-attach.
      if (initializedTabs.current.has(tab.id) && !info?.replacedPty) {
        console.log(`[AgentOS] Tab ${tab.id} already initialized, skipping tmux attach (reconnect)`);
        return;
      }
      initializedTabs.current.add(tab.id);

      // A paused (handed-off) session's tmux ended: nothing to attach, and
      // never a launch
      if (isPaused(sessions.find((s) => s.id === tab.sessionId))) return;

      // Determine tmux session name to attach
      const tmuxName = tab.sessionId
        ? sessions.find((s) => s.id === tab.sessionId)?.tmux_name ||
          tab.attachedTmux
        : tab.attachedTmux;

      // Opened beside: the session runs here instead of a shell
      const launch = !tmuxName && takePaneLaunch(paneId);
      if (launch) {
        setTimeout(() => launch(handle), 100);
      } else if (tmuxName) {
        // Existing session — re-attach
        setTimeout(() => handle.sendCommand(`${tmuxSetup}; tmux attach -t ${tmuxName}`), 100);
      } else {
        // Bare tab — create a new persistent tmux session
        const shellTmuxName = `shell-${tab.id}`;
        setTimeout(() => {
          handle.sendCommand(`${tmuxSetup}; tmux attach -t ${shellTmuxName} 2>/dev/null || tmux new -s ${shellTmuxName}`);
          attachSession(paneId, "", shellTmuxName);
        }, 100);
      }
    },
    [paneId, sessions, onRegisterTerminal, attachSession, tmuxSetup]
  );

  // Track current tab ID for cleanup
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTab?.id || null;

  // Cleanup on unmount only
  useEffect(() => {
    console.log(
      `[AgentOS] Pane ${paneId} mounted, activeTab: ${activeTab?.id || "null"}`
    );
    return () => {
      console.log(
        `[AgentOS] Pane ${paneId} unmounting, clearing terminal ref for tab: ${activeTabIdRef.current}`
      );
      if (activeTabIdRef.current) {
        onRegisterTerminal(paneId, activeTabIdRef.current, null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, onRegisterTerminal]);

  // Swipe gesture handling for mobile session switching (terminal view only)
  const touchStartX = useRef<number | null>(null);
  const currentIndex = session
    ? sessions.findIndex((s) => s.id === session.id)
    : -1;
  const SWIPE_THRESHOLD = 120;

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (viewMode !== "terminal") return;
      touchStartX.current = e.touches[0].clientX;
    },
    [viewMode]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (viewMode !== "terminal" || touchStartX.current === null) return;

      const diff = e.changedTouches[0].clientX - touchStartX.current;
      touchStartX.current = null;

      if (Math.abs(diff) <= SWIPE_THRESHOLD) return;

      const nextIndex = diff > 0 ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex >= 0 && nextIndex < sessions.length) {
        onSelectSession?.(sessions[nextIndex].id);
      }
    },
    [viewMode, currentIndex, sessions, onSelectSession]
  );

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden",
        !isMobile &&
          (chrome.variant === "card"
            ? // Desk-Beside: each session on its own card
              "border-hair rounded-[20px] border"
            : "rounded-lg shadow-lg shadow-black/10 dark:shadow-black/30"),
        // Two or more on screen: the one you type into is marked
        paneCount > 1 && isFocused && "ring-primary/60 ring-1 ring-inset"
      )}
      onClick={handleFocus}
    >
      {/* Tabs (wide, two or more), then the header naming the session */}
      {!isMobile && (
        <DesktopTabBar
          tabs={paneData.tabs}
          activeTabId={paneData.activeTabId}
          sessions={sessions}
          isFocused={isFocused}
          onTabSwitch={(tabId) => switchTab(paneId, tabId)}
          onTabClose={(tabId) => closeTab(paneId, tabId)}
          onTabAdd={() => addTab(paneId)}
        />
      )}
      {/* E-Git, E-Files: on the Duo those pages carry their own title, and
          the column goes back; a phone keeps the header's way back */}
      {!(layoutMode !== "phone" && layoutMode !== "desktop" && (viewMode === "git" || viewMode === "files")) && (
      <SessionTitleBar
        session={session}
        projects={projects}
        fallbackTitle={activeTab?.attachedTmux}
        isMobile={isMobile}
        isFocused={isFocused}
        viewMode={viewMode}
        agentCount={agentCount}
        onViewModeChange={setViewMode}
        hasAttachedTmux={!!activeTab?.attachedTmux}
        onDetach={handleDetach}
        gitDrawerOpen={gitDrawerOpen}
        shellDrawerOpen={shellDrawerOpen}
        canSplit={canSplit}
        canClose={canClose}
        onGitDrawerToggle={() => setGitDrawerOpen((prev) => !prev)}
        onShellDrawerToggle={() => setShellDrawerOpen((prev) => !prev)}
        onTabAdd={() => addTab(paneId)}
        onSplitHorizontal={() => splitHorizontal(paneId)}
        onSplitVertical={() => splitVertical(paneId)}
        onClose={() => close(paneId)}
      />
      )}
      {showStrip && session && <ActivityStrip session={session} />}

      {/* Content Area - Mobile: simple flex, Desktop: resizable panels */}
      {isMobile ? (
        <div
          className="native-column-inset relative min-h-0 w-full flex-1"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Terminals - one per tab */}
          {paneData.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            const savedState = sessionRegistry.getTerminalState(paneId, tab.id);

            return (
              <div
                key={tab.id}
                className={
                  viewMode === "terminal" && isActive
                    ? "h-full w-full"
                    : "hidden"
                }
              >
                <Terminal
                  ref={getTerminalRef(tab.id)}
                  draftId={tab.sessionId}
                  active={viewMode === "terminal" && isActive}
                  agentType={
                    sessions.find((s) => s.id === tab.sessionId)?.agent_type
                  }
                  session={sessions.find((s) => s.id === tab.sessionId)}
                  onDeck={
                    viewMode === "terminal" && isActive
                      ? setDeckShown
                      : undefined
                  }
                  onConnected={getTerminalConnectedHandler(tab)}
                  onBeforeUnmount={(scrollState) => {
                    sessionRegistry.saveTerminalState(paneId, tab.id, {
                      scrollTop: scrollState.scrollTop,
                      scrollHeight: 0,
                      lastActivity: Date.now(),
                      cursorY: scrollState.cursorY,
                    });
                  }}
                  initialScrollState={
                    savedState
                      ? {
                          scrollTop: savedState.scrollTop,
                          cursorY: savedState.cursorY,
                          baseY: 0,
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}

          {/* Chat: mounted only while shown, it polls the transcript */}
          {viewMode === "chat" && session && (
            <ChatView
              session={session}
              active
              hideAgentsBar={agentsShown}
              onOpenTerminal={() => setViewMode("terminal")}
              onDeck={setDeckShown}
              onEmpty={chatEmpty}
            />
          )}

          {/* Files */}
          {session?.working_directory && (
            <div className={viewMode === "files" ? "h-full" : "hidden"}>
              <FileExplorer
                sessionId={session.id}
                active={isFocused && viewMode === "files"}
                workingDirectory={session.working_directory}
                fileEditor={fileEditor}
              />
            </div>
          )}

          {/* Changes */}
          {session?.working_directory && (
            <div className={viewMode === "git" ? "h-full" : "hidden"}>
              <GitPanel
                sessionId={session.id}
                active={isFocused && viewMode === "git"}
                workingDirectory={session.working_directory}
                projectId={currentProject?.id}
                repositories={projectRepositories}
              />
            </div>
          )}

          {/* Agents */}
          {viewMode === "agents" && session && (
            <AgentsView
              session={session}
              active
              onOpenSession={(id) => onSelectSession?.(id)}
              onClose={() =>
                setViewMode(openingView(session.id, session.agent_type, chatDefault))
              }
            />
          )}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          {/* Left column: Main content + Shell drawer */}
          <ResizablePanel defaultSize={showGitDrawer ? 70 : 100} minSize={20}>
            <ResizablePanelGroup orientation="vertical" className="h-full">
              {/* Main content */}
              <ResizablePanel
                defaultSize={shellDrawerOpen ? 70 : 100}
                minSize={10}
              >
                <div className="relative h-full">
                  {/* Terminals - one per tab */}
                  {paneData.tabs.map((tab) => {
                    const isActive = tab.id === activeTab?.id;
                    const savedState = sessionRegistry.getTerminalState(
                      paneId,
                      tab.id
                    );

                    return (
                      <div
                        key={tab.id}
                        className={
                          viewMode === "terminal" && isActive
                            ? "h-full"
                            : "hidden"
                        }
                      >
                        <Terminal
                          ref={getTerminalRef(tab.id)}
                          draftId={tab.sessionId}
                          active={viewMode === "terminal" && isActive}
                          agentType={
                            sessions.find((s) => s.id === tab.sessionId)
                              ?.agent_type
                          }
                          session={sessions.find(
                            (s) => s.id === tab.sessionId
                          )}
                          onDeck={
                            viewMode === "terminal" && isActive
                              ? setDeckShown
                              : undefined
                          }
                          onConnected={getTerminalConnectedHandler(tab)}
                          onBeforeUnmount={(scrollState) => {
                            sessionRegistry.saveTerminalState(paneId, tab.id, {
                              scrollTop: scrollState.scrollTop,
                              scrollHeight: 0,
                              lastActivity: Date.now(),
                              cursorY: scrollState.cursorY,
                            });
                          }}
                          initialScrollState={
                            savedState
                              ? {
                                  scrollTop: savedState.scrollTop,
                                  cursorY: savedState.cursorY,
                                  baseY: 0,
                                }
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}

                  {/* Chat */}
                  {viewMode === "chat" && session && (
                    <ChatView
                      session={session}
                      active
                      hideAgentsBar={agentsShown}
                      onOpenTerminal={() => setViewMode("terminal")}
                      onDeck={setDeckShown}
                      onEmpty={chatEmpty}
                    />
                  )}

                  {/* Files */}
                  {session?.working_directory && (
                    <div className={viewMode === "files" ? "h-full" : "hidden"}>
                      <FileExplorer
                        sessionId={session.id}
                        active={isFocused && viewMode === "files"}
                        workingDirectory={session.working_directory}
                        fileEditor={fileEditor}
                      />
                    </div>
                  )}

                  {/* Changes */}
                  {viewMode === "git" && session?.working_directory && (
                    <div className="h-full">
                      <GitPanel
                        sessionId={session.id}
                        active={isFocused && viewMode === "git"}
                        workingDirectory={session.working_directory}
                        projectId={currentProject?.id}
                        repositories={projectRepositories}
                      />
                    </div>
                  )}

                  {/* Agents */}
                  {viewMode === "agents" && session && (
                    <AgentsView
                      session={session}
                      active
                      onOpenSession={(id) => onSelectSession?.(id)}
                      onClose={() =>
                        setViewMode(
                          openingView(session.id, session.agent_type, chatDefault)
                        )
                      }
                    />
                  )}
                </div>
              </ResizablePanel>

              {/* Shell drawer - under main content */}
              {shellDrawerOpen && session?.working_directory && (
                <>
                  <ResizablePanelHandle className="bg-border/30 hover:bg-primary/30 active:bg-primary/50 h-px cursor-row-resize transition-colors" />
                  <ResizablePanel defaultSize={30} minSize={10}>
                    <ShellDrawer
                      open={true}
                      onOpenChange={setShellDrawerOpen}
                      workingDirectory={session.working_directory}
                      sessionId={session.id}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Git drawer - right side, full height */}
          {showGitDrawer && session?.working_directory && (
            <>
              <ResizablePanelHandle className="bg-border/30 hover:bg-primary/30 active:bg-primary/50 w-px cursor-col-resize transition-colors" />
              <ResizablePanel defaultSize={30} minSize={10}>
                <GitPanel
                  sessionId={session.id}
                  workingDirectory={session.working_directory}
                  projectId={currentProject?.id}
                  repositories={projectRepositories}
                  onClose={() => setGitDrawerOpen(false)}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}
    </div>
  );
});
