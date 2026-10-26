"use client";

import { useRef, useCallback, useEffect, memo, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePanes } from "@/contexts/PaneContext";
import { useViewport } from "@/hooks/useViewport";
import type {
  TerminalHandle,
  TerminalScrollState,
} from "@/components/Terminal";
import type { Session, Project } from "@/lib/db";
import { sessionRegistry } from "@/lib/client/session-registry";
import { cn } from "@/lib/utils";
import { ConductorPanel } from "@/components/ConductorPanel";
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
import { GitDrawer } from "@/components/GitDrawer";
import { ShellDrawer } from "@/components/ShellDrawer";
import { useSnapshot } from "valtio";
import { fileOpenStore, fileOpenActions } from "@/stores/fileOpen";
import { mobileNavStore, mobileNavActions } from "@/stores/mobileNav";
import { focusStore } from "@/stores/focus";
import { getSessionView, setSessionView } from "@/lib/session-views";
import { takePaneLaunch } from "@/stores/beside";
import { ActivityStrip } from "@/components/Session/ActivityStrip";
import { isNative } from "@/lib/native-bridge";
import { useSharedFiles } from "@/hooks/useSharedFiles";
import { useGitStatus } from "@/data/git/queries";

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

type ViewMode = "terminal" | "chat" | "files" | "git" | "workers";


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
        const value = typeof next === "function" ? next(mode) : next;
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

  // File editor state - lifted here so it persists across view switches
  const fileEditor = useFileEditor();

  // A conductor's workers, shown from the header's ⋯
  const workerCount = useMemo(() => {
    if (!session) return 0;
    return sessions.filter((s) => s.conductor_session_id === session.id).length;
  }, [session, sessions]);

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
  const showStrip =
    !!session &&
    (viewMode === "chat" || viewMode === "terminal") &&
    !focusOn &&
    !railShown &&
    !deckShown;
  // The strip or the rail (beside the focused pane) lists its agents already
  const agentsShown = showStrip || (railShown && isFocused);

  // Reset view mode and file editor when session changes
  useEffect(() => {
    // A remount (folding) shows the same session: keep its view
    const previous = paneSessions.get(paneId);
    paneSessions.set(paneId, session?.id);
    if (previous === session?.id) return;
    // Each session opens in the view you last used there (terminal at first)
    setViewMode((session && getSessionView(session.id)) || "terminal");
    fileEditor.reset();
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember a change of view; a switch of session alone isn't one
  const viewSessionId = useRef(session?.id);
  viewSessionId.current = session?.id;
  useEffect(() => {
    const id = viewSessionId.current;
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
    if (isFocused) mobileNavStore.viewMode = viewMode;
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
        !isMobile && "rounded-lg shadow-lg shadow-black/10 dark:shadow-black/30",
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
      <SessionTitleBar
        session={session}
        projects={projects}
        fallbackTitle={activeTab?.attachedTmux}
        isMobile={isMobile}
        isFocused={isFocused}
        viewMode={viewMode}
        workerCount={workerCount}
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
            />
          )}

          {/* Files */}
          {session?.working_directory && (
            <div className={viewMode === "files" ? "h-full" : "hidden"}>
              <FileExplorer
                workingDirectory={session.working_directory}
                fileEditor={fileEditor}
              />
            </div>
          )}

          {/* Changes */}
          {session?.working_directory && (
            <div className={viewMode === "git" ? "h-full" : "hidden"}>
              <GitPanel
                workingDirectory={session.working_directory}
                projectId={currentProject?.id}
                repositories={projectRepositories}
              />
            </div>
          )}

          {/* Workers */}
          {viewMode === "workers" && session && (
            <ConductorPanel
              conductorSessionId={session.id}
              onAttachToWorker={(workerId) => {
                setViewMode("terminal");
                const worker = sessions.find((s) => s.id === workerId);
                if (worker && terminalRef) {
                  const sessionName = `claude-${workerId}`;
                  terminalRef.sendInput("\x02d");
                  setTimeout(() => {
                    terminalRef?.sendInput("\x15");
                    setTimeout(() => {
                      terminalRef?.sendCommand(`${tmuxSetup}; tmux attach -t ${sessionName}`);
                    }, 50);
                  }, 100);
                }
              }}
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
                    />
                  )}

                  {/* Files */}
                  {session?.working_directory && (
                    <div className={viewMode === "files" ? "h-full" : "hidden"}>
                      <FileExplorer
                        workingDirectory={session.working_directory}
                        fileEditor={fileEditor}
                      />
                    </div>
                  )}

                  {/* Changes */}
                  {viewMode === "git" && session?.working_directory && (
                    <div className="h-full">
                      <GitPanel
                        workingDirectory={session.working_directory}
                        projectId={currentProject?.id}
                        repositories={projectRepositories}
                      />
                    </div>
                  )}

                  {/* Workers */}
                  {viewMode === "workers" && session && (
                    <ConductorPanel
                      conductorSessionId={session.id}
                      onAttachToWorker={(workerId) => {
                        setViewMode("terminal");
                        const worker = sessions.find((s) => s.id === workerId);
                        if (worker && terminalRef) {
                          const sessionName = `claude-${workerId}`;
                          terminalRef.sendInput("\x02d");
                          setTimeout(() => {
                            terminalRef?.sendInput("\x15");
                            setTimeout(() => {
                              terminalRef?.sendCommand(
                                `${tmuxSetup}; tmux attach -t ${sessionName}`
                              );
                            }, 50);
                          }, 100);
                        }
                      }}
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
