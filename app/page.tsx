"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";

// Debug log buffer - persists even if console is closed
const debugLogs: string[] = [];
const MAX_DEBUG_LOGS = 100;

function debugLog(message: string) {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  const entry = `[${timestamp}] ${message}`;
  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
  console.log(`[AgentOS] ${message}`);
}

// Expose to window for debugging
if (typeof window !== "undefined") {
  (window as unknown as { agentOSLogs: () => void }).agentOSLogs = () => {
    console.log("=== AgentOS Debug Logs ===");
    debugLogs.forEach((log) => console.log(log));
    console.log("=== End Logs ===");
  };
}
import { PaneProvider, usePanes } from "@/contexts/PaneContext";
import { Pane } from "@/components/Pane";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useAgentNotices,
  useNeedsYou,
  type NotificationEntry,
} from "@/hooks/useNeedsYou";
import { openBackgroundAgent } from "@/components/BackgroundAgents";
import { useViewport } from "@/hooks/useViewport";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useNativeBridge } from "@/hooks/useNativeBridge";
import { useSessionLinks } from "@/hooks/useSessionLinks";
import { usePresence } from "@/hooks/usePresence";
import { useFoldPosture } from "@/hooks/useFoldPosture";
import { useViewShortcuts } from "@/hooks/useViewShortcuts";
import { layoutStore, useLayoutModeSource } from "@/hooks/useLayoutMode";
import {
  homeAfterSwitch,
  lastPageUsed,
  notePageUsed,
  surfaceStore,
  useSurfaceSource,
} from "@/stores/surface";
import { useSessions } from "@/hooks/useSessions";
import { useProjects } from "@/hooks/useProjects";
import { useDevServersManager } from "@/hooks/useDevServersManager";
import { useSessionStatuses } from "@/hooks/useSessionStatuses";
import type { Session } from "@/lib/db";
import type { TerminalHandle } from "@/components/Terminal";
import { generatePaneId, getAllPaneIds } from "@/lib/panes";
import { typingElsewhere } from "@/lib/typing-elsewhere";
import { useColumnOrderSource } from "@/hooks/useColumnOrder";
import { useTerminalFontSource } from "@/hooks/useTerminalFont";
import { getProvider } from "@/lib/providers";
import { getProviderDefinition } from "@/lib/providers/registry";
import { DesktopView } from "@/components/views/DesktopView";
import { MobileView } from "@/components/views/MobileView";
import { getPendingPrompt, clearPendingPrompt } from "@/stores/initialPrompt";
import { closeSettings } from "@/stores/settingsPage";
import { closePage, workspacePageStore } from "@/stores/workspacePage";
import { besideStore, setPaneLaunch } from "@/stores/beside";
import {
  closeNew,
  keepNewDraftOnClose,
  newSurfaceStore,
  openNew,
} from "@/stores/newSurface";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { focusStore, loadFocus } from "@/stores/focus";
import {
  noteOrigin,
  registerNavHandlers,
  resumeView,
  runNav,
} from "@/lib/nav-actions";
import { WIDE } from "@/lib/column-spec";
import { backStore } from "@/stores/back";
import { runningStore } from "@/stores/running";
import { isNative } from "@/lib/native-bridge";
import { isEnded } from "@/lib/settle-types";
import { SettingsPage } from "@/components/Settings/SettingsPage";
import { ScriptsSheetHost } from "@/components/Projects/ScriptsSheet";
import { useScriptShortcuts } from "@/hooks/useScriptShortcuts";
import { useFreshSessionCleanup } from "@/hooks/useFreshSessionCleanup";
import { OPEN_SESSION_EVENT, type OpenSessionDetail } from "@/lib/bg-send";
import { EdgeBack } from "@/components/EdgeBack";
import { keepPlace, restorePlace, takePlace } from "@/stores/place";

/** A workspace page on the open Duo's right page (not one across both) */
const pageBeside = () => {
  const kind = workspacePageStore.page?.kind;
  return !!kind && kind !== "inbox" && kind !== "running";
};

function HomeContent() {
  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // New is its own store, so a project's menu or the agents list can open it
  const { open: showNewSessionDialog, projectId: newSessionProjectId } =
    useSnapshot(newSurfaceStore);
  const setShowNewSessionDialog = useCallback(
    (show: boolean) => (show ? openNew() : closeNew()),
    []
  );
  const [showNotificationSettings, setShowNotificationSettings] =
    useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map());

  // Pane context
  const {
    state: paneState,
    focusedPaneId,
    attachSession,
    getActiveTab,
    addTab,
    focusPane,
    splitHorizontal,
    close: closePane,
    maxPanes,
  } = usePanes();
  const focusedActiveTab = getActiveTab(focusedPaneId);
  const { isMobile, isHydrated } = useViewport();

  // Data hooks
  const { sessions, fetchSessions } = useSessions();
  const { projects, fetchProjects } = useProjects();
  const {
    startDevServerProjectId,
    setStartDevServerProjectId,
    startDevServer,
    createDevServer,
  } = useDevServersManager();

  // Helper to get init script command from API
  const getInitScriptCommand = useCallback(
    async (agentCommand: string): Promise<string> => {
      try {
        const res = await fetch("/api/sessions/init-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentCommand }),
        });
        const data = await res.json();
        return data.command || agentCommand;
      } catch {
        return agentCommand;
      }
    },
    []
  );

  // Set CSS variable for viewport height (handles mobile keyboard)
  useViewportHeight();

  // A session picked before any terminal connected, and the attach that
  // opens it (defined below) once one registers
  const queuedSession = useRef<{ session: Session; ts: number } | null>(null);
  const attachToSessionRef = useRef<((session: Session) => void) | null>(
    null
  );

  // Terminal ref management
  const registerTerminalRef = useCallback(
    (paneId: string, tabId: string, ref: TerminalHandle | null) => {
      const key = `${paneId}:${tabId}`;
      if (ref) {
        terminalRefs.current.set(key, ref);
        debugLog(
          `Terminal registered: ${key}, total refs: ${terminalRefs.current.size}`
        );
        // A session picked while none was connected opens now, unless it
        // waited too long to still be what you want
        const queued = queuedSession.current;
        queuedSession.current = null;
        if (queued && Date.now() - queued.ts < 15_000) {
          setTimeout(() => attachToSessionRef.current?.(queued.session), 0);
        }
      } else {
        terminalRefs.current.delete(key);
        debugLog(
          `Terminal unregistered: ${key}, total refs: ${terminalRefs.current.size}`
        );
      }
    },
    []
  );

  // Get terminal for a pane, with fallback to first available
  const getTerminalWithFallback = useCallback(():
    | { terminal: TerminalHandle; paneId: string; tabId: string }
    | undefined => {
    debugLog(
      `getTerminalWithFallback called, total refs: ${terminalRefs.current.size}, focusedPaneId: ${focusedPaneId}`
    );

    // Try focused pane first
    const activeTab = getActiveTab(focusedPaneId);
    debugLog(`activeTab for focused pane: ${activeTab?.id || "null"}`);

    if (activeTab) {
      const key = `${focusedPaneId}:${activeTab.id}`;
      const terminal = terminalRefs.current.get(key);
      debugLog(
        `Looking for terminal at key "${key}": ${terminal ? "found" : "not found"}`
      );
      if (terminal) {
        return { terminal, paneId: focusedPaneId, tabId: activeTab.id };
      }
    }

    // Fallback to first available terminal
    const firstEntry = terminalRefs.current.entries().next().value;
    if (firstEntry) {
      const [key, terminal] = firstEntry as [string, TerminalHandle];
      const [paneId, tabId] = key.split(":");
      debugLog(`Using fallback terminal: ${key}`);
      return { terminal, paneId, tabId };
    }

    debugLog(
      `NO TERMINAL FOUND. Available keys: ${Array.from(terminalRefs.current.keys()).join(", ") || "none"}`
    );
    return undefined;
  }, [focusedPaneId, getActiveTab]);

  // Build tmux command for a session (lib/session-launch.ts does the same for
  // sessions started without a page, so keep the two in step)
  const buildSessionCommand = useCallback(
    async (
      session: Session
    ): Promise<{ sessionName: string; cwd: string; command: string }> => {
      const provider = getProvider(session.agent_type || "claude");
      const sessionName = session.tmux_name || `${provider.id}-${session.id}`;
      const cwd = session.working_directory?.replace("~", "$HOME") || "$HOME";

      // Shell sessions just open a terminal - no agent command; a paused
      // (handed-off) or settled one is never relaunched (runSessionInTerminal)
      if (provider.id === "shell" || isEnded(session)) {
        return { sessionName, cwd, command: "" };
      }

      // Get parent session ID for forking
      let parentSessionId: string | null = null;
      if (!session.claude_session_id && session.parent_session_id) {
        const parentSession = sessions.find(
          (s) => s.id === session.parent_session_id
        );
        parentSessionId = parentSession?.claude_session_id || null;
      }

      // Check for pending initial prompt
      const initialPrompt = getPendingPrompt(session.id);
      if (initialPrompt) {
        clearPendingPrompt(session.id);
      }

      // For providers with native worktree support, pass the branch name so
      // the CLI creates and manages the worktree itself (e.g. claude --worktree)
      const providerDef = getProviderDefinition(session.agent_type || "claude");
      const nativeWorktreeName =
        session.branch_name && !session.worktree_path && providerDef.worktreeFlag
          ? session.branch_name
          : undefined;

      // A Claude session in a project starts knowing the other sessions in it
      let systemPromptFile: string | undefined;
      let settingsFile: string | undefined;
      if (provider.id === "claude") {
        try {
          const res = await fetch(
            `/api/sessions/${session.id}/project-context`,
            { method: "POST" }
          );
          const context = await res.json();
          systemPromptFile = context.file || undefined;
          settingsFile = context.settings || undefined;
        } catch {
          // Starts without the note
        }
      }

      const flags = provider.buildFlags({
        systemPromptFile,
        settingsFile,
        sessionId: session.claude_session_id,
        parentSessionId,
        autoApprove: session.auto_approve,
        permissionMode: session.permission_mode,
        continueSession: session.continue_session,
        model: session.model,
        modelPinned: !!session.model_pinned,
        effort: session.effort,
        initialPrompt: initialPrompt || undefined,
        worktreeName: nativeWorktreeName,
      });
      const flagsStr = flags.join(" ");

      const agentCmd = `${provider.command} ${flagsStr}`;
      const command = await getInitScriptCommand(agentCmd);

      return { sessionName, cwd, command };
    },
    [sessions, getInitScriptCommand]
  );

  // Attach a session to a terminal. leave: out of what the terminal shows
  // first (another session's tmux); otherwise it starts in a fresh shell
  const runSessionInTerminal = useCallback(
    async (
      terminal: TerminalHandle,
      paneId: string,
      session: Session,
      sessionInfo: { sessionName: string; cwd: string; command: string },
      leave = false
    ) => {
      // Paused (handed off, M4) or settled (M8): its chat shows, its agent
      // isn't relaunched
      if (isEnded(session)) {
        attachSession(paneId, session.id, "");
        return;
      }
      const { sessionName, cwd, command } = sessionInfo;
      // For shell sessions (empty command), just start tmux without a command so it opens the default shell
      const tmuxNew = command
        ? `tmux new -s ${sessionName} -c "${cwd}" "${command}"`
        : `tmux new -s ${sessionName} -c "${cwd}"`;
      const tmuxSetup = [
        `tmux set-option -g mouse on`,
        `tmux set-option -g history-limit 50000`,
        // A row per wheel event: the page sends one per row of travel
        `tmux bind-key -T copy-mode WheelUpPane send-keys -X scroll-up`,
        `tmux bind-key -T copy-mode WheelDownPane send-keys -X scroll-down`,
        `tmux bind-key -T copy-mode-vi WheelUpPane send-keys -X scroll-up`,
        `tmux bind-key -T copy-mode-vi WheelDownPane send-keys -X scroll-down`,
        `tmux bind-key m display-menu -T "Tmux" -x R -y P "Copy Mode" c copy-mode "Paste Buffer" p paste-buffer "" "" "" "Split Horizontal" h 'split-window -h' "Split Vertical" v 'split-window -v'`,
      ].map(c => `${c} 2>/dev/null`).join("; ");
      // The server types it only at the shell's prompt, never into tmux or
      // an agent running there
      const typed = await terminal.sendShellCommand(
        `${tmuxSetup}; tmux attach -t ${sessionName} 2>/dev/null || ${tmuxNew}`,
        leave
      );
      if (!typed) {
        debugLog(`Terminal busy, not attaching: ${session.name}`);
        toast("Terminal busy", {
          description: "Quit what runs there, then open the session again",
        });
        return;
      }
      attachSession(paneId, session.id, sessionName);
      // A pane starting beside the one being typed into leaves the keyboard
      if (!typingElsewhere()) terminal.focus();
    },
    [attachSession]
  );

  // Leave whatever a pane's terminal runs and attach the session there.
  // The server knows whether it's in tmux (the tab's attachedTmux can lag)
  const switchTerminalTo = useCallback(
    async (terminal: TerminalHandle, paneId: string, session: Session) => {
      const sessionInfo = await buildSessionCommand(session);
      await runSessionInTerminal(terminal, paneId, session, sessionInfo, true);
    },
    [buildSessionCommand, runSessionInTerminal]
  );

  // Attach session to terminal
  const attachToSession = useCallback(
    async (session: Session) => {
      // Its back returns to what it was opened from
      noteOrigin(session.id);
      // Whatever opened it, the session shows rather than staying under
      // Settings or a workspace page (a half-typed New is kept for later)
      keepNewDraftOnClose();
      closeSettings();
      closePage();
      const terminalInfo = getTerminalWithFallback();
      if (!terminalInfo) {
        // Picked before the first terminal connected: it opens once one does
        debugLog(`No terminal yet, queueing session: ${session.name}`);
        queuedSession.current = { session, ts: Date.now() };
        return;
      }
      queuedSession.current = null;
      switchTerminalTo(terminalInfo.terminal, terminalInfo.paneId, session);
    },
    [getTerminalWithFallback, switchTerminalTo]
  );
  attachToSessionRef.current = attachToSession;

  // Open beside: a session in a pane next to the focused one (the other
  // page on the open Duo). Splits while there's room, keeping the focus on
  // the pane being typed into, else takes the other pane over. Already on
  // screen, it just takes focus.
  const openSessionBeside = useCallback(
    (session: Session) => {
      // One screen, one session: it just opens
      if (isMobile) {
        attachToSession(session);
        return;
      }
      closeSettings();
      closePage();
      const ids = getAllPaneIds(paneState.layout);
      const showing = ids.find(
        (id) => getActiveTab(id)?.sessionId === session.id
      );
      if (showing) {
        focusPane(showing);
        return;
      }
      if (ids.length < maxPanes) {
        // The new pane runs the session in place of its own shell, once
        // its terminal connects
        const paneId = generatePaneId();
        setPaneLaunch(paneId, (terminal) =>
          buildSessionCommand(session).then((info) =>
            runSessionInTerminal(terminal, paneId, session, info)
          )
        );
        splitHorizontal(focusedPaneId, paneId);
        // Leaving side by side or folding keeps the session you were in
        focusPane(focusedPaneId);
        return;
      }
      const target = ids.filter((id) => id !== focusedPaneId).at(-1);
      const tab = target ? getActiveTab(target) : null;
      const terminal = tab && terminalRefs.current.get(`${target}:${tab.id}`);
      if (!target || !terminal) return;
      focusPane(target);
      switchTerminalTo(terminal, target, session);
    },
    [
      isMobile,
      attachToSession,
      paneState.layout,
      getActiveTab,
      focusPane,
      maxPanes,
      splitHorizontal,
      focusedPaneId,
      buildSessionCommand,
      runSessionInTerminal,
      switchTerminalTo,
    ]
  );

  const { request: besideRequest } = useSnapshot(besideStore);
  useEffect(() => {
    if (!besideRequest) return;
    besideStore.request = null;
    const session = sessions.find((s) => s.id === besideRequest.sessionId);
    if (!session || Date.now() - besideRequest.ts > 10_000) return;
    if (besideRequest.view)
      mobileNavActions.requestViewMode(besideRequest.view, session.id);
    // One page has no beside: open it there rather than swap out yours
    if (WIDE.includes(layoutStore.mode)) openSessionBeside(session);
    else attachToSession(session);
  }, [besideRequest, sessions, openSessionBeside, attachToSession]);

  // Open session in new tab
  const openSessionInNewTab = useCallback(
    (session: Session) => {
      const existingKeys = new Set(terminalRefs.current.keys());
      addTab(focusedPaneId);

      let attempts = 0;
      const maxAttempts = 20;

      const waitForNewTerminal = () => {
        attempts++;

        for (const key of terminalRefs.current.keys()) {
          if (!existingKeys.has(key) && key.startsWith(`${focusedPaneId}:`)) {
            const terminal = terminalRefs.current.get(key);
            if (terminal) {
              buildSessionCommand(session).then((sessionInfo) => {
                runSessionInTerminal(
                  terminal,
                  focusedPaneId,
                  session,
                  sessionInfo
                );
              });
              return;
            }
          }
        }

        if (attempts < maxAttempts) {
          setTimeout(waitForNewTerminal, 50);
        } else {
          debugLog(`Failed to find new terminal after ${maxAttempts} attempts`);
        }
      };

      setTimeout(waitForNewTerminal, 50);
    },
    [addTab, focusedPaneId, buildSessionCommand, runSessionInTerminal]
  );

  // Notification click handler
  const handleNotificationClick = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        attachToSession(session);
        if (isMobile) setSidebarOpen(false);
      }
    },
    [sessions, attachToSession, isMobile]
  );

  // Notifications
  const {
    settings: notificationSettings,
    checkStateChanges,
    notify,
    updateSettings,
    requestPermission,
    permissionGranted,
  } = useNotifications({ onSessionClick: handleNotificationClick });

  // Session statuses
  const { sessionStatuses } = useSessionStatuses({
    sessions,
    activeSessionId: focusedActiveTab?.sessionId,
    checkStateChanges,
  });

  useFoldPosture();
  useLayoutModeSource();
  useColumnOrderSource();
  useTerminalFontSource();
  useSurfaceSource({
    paneCount: getAllPaneIds(paneState.layout).length,
    searchOpen: showQuickSwitcher,
    behind: !!focusedActiveTab?.sessionId,
  });
  useEffect(loadFocus, []);
  useEffect(() => {
    runningStore.sessionId = focusedActiveTab?.sessionId ?? null;
  }, [focusedActiveTab?.sessionId]);
  // Back's labels name the project they go back to
  useEffect(() => {
    backStore.projectNames = Object.fromEntries(
      projects.map((p) => [p.id, p.name])
    );
  }, [projects]);
  const lastBesideRef = useRef(0);
  useEffect(
    () =>
      registerNavHandlers({
        // The open Duo lands on the conversation, not Changes or Files
        // across both pages
        resume: () => {
          closePage();
          setSidebarOpen(false);
          const view = resumeView(
            layoutStore.mode,
            mobileNavStore.viewMode,
            mobileNavStore.conversationView
          );
          if (view) mobileNavActions.requestViewMode(view);
        },
        // On a phone a page covers the home: leave it for the home
        openSessions: () =>
          isMobile && closePage()
            ? setSidebarOpen(true)
            : setSidebarOpen((open) => !open),
        openFind: () => setShowQuickSwitcher(true),
        // At once, so the action that closes it sees what was under it
        closeFind: () => {
          surfaceStore.searchOpen = false;
          setShowQuickSwitcher(false);
        },
        // On a project page, in that project (as the page's own + does)
        openNewSession: () => {
          const page = workspacePageStore.page;
          if (page?.kind === "project")
            openNew({ projectId: page.projectId, runAs: "session" });
          else openNew();
        },
        // Now, never toggled: what covers the home closes
        openNow: () => {
          closePage();
          setSidebarOpen(true);
        },
        // Past every layer: Find closes, else Now
        goBack: () => {
          if (surfaceStore.searchOpen) return setShowQuickSwitcher(false);
          closePage();
          setSidebarOpen(true);
        },
        // The most recent other session beside the focused one (workers
        // show inside their conductor's)
        openBeside: () => {
          // One page has no beside: it never swaps another session in
          if (!WIDE.includes(layoutStore.mode)) return;
          // The column's toggle: one press, delivered twice, mustn't undo itself
          const now = Date.now();
          if (now - lastBesideRef.current < 700) return;
          lastBesideRef.current = now;
          // Already side by side: back to the session being typed into, alone
          const ids = getAllPaneIds(paneState.layout);
          if (ids.length > 1) {
            ids.filter((id) => id !== focusedPaneId).forEach(closePane);
            return;
          }
          const current = focusedActiveTab?.sessionId;
          const next = sessions
            .filter((s) => s.id !== current && !s.conductor_session_id)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
          if (next) openSessionBeside(next);
          setSidebarOpen(false);
        },
      }),
    [
      isMobile,
      sessions,
      focusedActiveTab?.sessionId,
      openSessionBeside,
      paneState.layout,
      focusedPaneId,
      closePane,
    ]
  );

  // One count for the column badge, the iOS app and the Now hero: waiting
  // sessions plus blocked background agents
  const needs = useNeedsYou(sessions, sessionStatuses);
  useEffect(() => {
    mobileNavStore.needsYou = needs.count;
  }, [needs.count]);
  useNativeBridge({ waitingCount: needs.count });

  // Background agents only reach the browser through the server's history
  const agents = needs.agents;
  const noticeAgent = useCallback(
    (entry: NotificationEntry) => {
      const id = entry.agentId ?? entry.id;
      notify(
        entry.kind === "agentNeedsYou" ? "waiting" : "completed",
        id,
        entry.projectName ?? "Background agent",
        entry.body,
        {
          title: entry.title,
          actionLabel: "Open agent",
          // Its own switch: "A background agent finishes"
          setting:
            entry.kind === "agentNeedsYou" ? "waiting" : "backgroundFinished",
          onClick: () => {
            const agent = agents.find((a) => a.id === id);
            if (agent) openBackgroundAgent(agent);
            else runNav("inbox");
          },
        }
      );
    },
    [notify, agents]
  );
  useAgentNotices(needs.history, noticeAgent);

  // Notification links open their session; on a phone, over the home. A
  // link can land before the start state below is chosen, so note it
  const linkedSession = useRef(false);
  useSessionLinks(sessions, (session) => {
    // A link that loaded the page can come before the first terminal: it
    // queues like a pick, so a session picked after it still wins
    linkedSession.current = true;
    attachToSession(session);
    if (isMobile) setSidebarOpen(false);
  });
  usePresence(focusedActiveTab?.sessionId ?? undefined);

  // Open beside the session on the web, unless Focus is on. On narrow
  // screens and the open iPhone Duo (where the home is a page that back
  // shows) start on the home unless a session is up. A reload of the tab
  // starts where it was (stores/place), unless a link opened a session
  const started = useRef(false);
  const wasNarrow = useRef(false);
  const phoneHome = useRef<{ home: boolean; sessionId: string | null }>(null);
  const homeForPage = useRef(false);
  useEffect(() => {
    if (!isHydrated) return;
    const onSession = !!focusedActiveTab?.sessionId || linkedSession.current;
    const linked = linkedSession.current;
    linkedSession.current = false;
    const narrow = isMobile || isNative();
    if (!started.current) {
      started.current = true;
      wasNarrow.current = narrow;
      const place = takePlace();
      if (place && !linked) {
        restorePlace(place);
        setShowQuickSwitcher(place.find);
        setSidebarOpen(place.home || (narrow && !onSession));
      } else {
        setSidebarOpen(narrow ? !onSession : !focusStore.on);
      }
      // For as long as the page lives
      keepPlace();
      return;
    }
    // Folding, unfolding or turning keeps what showed (stores/surface)
    const sessionId = focusedActiveTab?.sessionId ?? null;
    if (!narrow && wasNarrow.current)
      phoneHome.current = { home: sidebarOpen, sessionId };
    const next = homeAfterSwitch({
      narrow,
      wasNarrow: wasNarrow.current,
      onePage: isMobile,
      onSession,
      sessionId,
      home: sidebarOpen,
      focus: focusStore.on,
      before: phoneHome.current,
      pageBeside: pageBeside(),
      homeForPage: homeForPage.current,
      lastPage: lastPageUsed(),
    });
    wasNarrow.current = narrow;
    homeForPage.current = next.homeForPage;
    setSidebarOpen(next.home);
  }, [isMobile, isHydrated]);
  // Now opened by hand is the page in use; closed, it no longer only sits
  // beside a page
  useEffect(() => {
    if (sidebarOpen && !homeForPage.current) notePageUsed("home");
    if (!sidebarOpen) homeForPage.current = false;
  }, [sidebarOpen]);

  useViewShortcuts();

  // A restarted session (lib/restart-session.ts) starts again in the terminal
  useEffect(() => {
    const onRestarted = (e: Event) => {
      const session = (e as CustomEvent<{ session: Session }>).detail.session;
      attachToSession(session);
      if (isMobile) setSidebarOpen(false);
    };
    window.addEventListener("agentos-session-restarted", onRestarted);
    return () =>
      window.removeEventListener("agentos-session-restarted", onRestarted);
  }, [attachToSession, isMobile]);

  // A session opened from inside one (background send, M10: the fresh one,
  // or the toast's Open)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { session } = (e as CustomEvent<OpenSessionDetail>).detail;
      attachToSession(session);
      if (isMobile) setSidebarOpen(false);
    };
    window.addEventListener(OPEN_SESSION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SESSION_EVENT, onOpen);
  }, [attachToSession, isMobile]);

  // A background agent (components/BackgroundAgents) opens in the terminal
  useEffect(() => {
    const onAttach = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      if (!/^\w[\w-]*$/.test(id)) return;
      const terminalInfo = getTerminalWithFallback();
      if (!terminalInfo) return;
      const { terminal } = terminalInfo;
      // Out of any tmux session first, as attaching a session does
      terminal.sendShellCommand(`claude attach ${id}`, true);
      terminal.focus();
      if (isMobile) setSidebarOpen(false);
    };
    window.addEventListener("agentos-attach-background", onAttach);
    return () =>
      window.removeEventListener("agentos-attach-background", onAttach);
  }, [getTerminalWithFallback, isMobile]);

  // Session selection handler
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      debugLog(`handleSelectSession called for: ${sessionId}`);
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        debugLog(`Found session: ${session.name}, calling attachToSession`);
        attachToSession(session);
      } else {
        debugLog(
          `Session not found in sessions array (length: ${sessions.length})`
        );
      }
    },
    [sessions, attachToSession]
  );

  // Pane renderer
  const renderPane = useCallback(
    (paneId: string) => (
      <Pane
        key={paneId}
        paneId={paneId}
        sessions={sessions}
        projects={projects}
        onRegisterTerminal={registerTerminalRef}
        onSelectSession={handleSelectSession}
      />
    ),
    [sessions, projects, registerTerminalRef, handleSelectSession]
  );

  // New session in project handler
  const handleNewSessionInProject = useCallback((projectId: string) => {
    openNew({ projectId, runAs: "session" });
  }, []);

  // Session created handler (shared between desktop/mobile)
  const handleSessionCreated = useCallback(
    async (sessionId: string) => {
      closeNew();
      await fetchSessions();

      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (!data.session) return;

      setTimeout(() => attachToSession(data.session), 100);
      // On a phone the home would cover it
      if (isMobile) setSidebarOpen(false);
    },
    [fetchSessions, attachToSession, isMobile]
  );

  // Project created handler (shared between desktop/mobile)
  const handleCreateProject = useCallback(
    async (
      name: string,
      workingDirectory: string,
      agentType?: string
    ): Promise<string | null> => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, workingDirectory, agentType }),
      });
      const data = await res.json();
      if (data.project) {
        await fetchProjects();
        return data.project.id;
      }
      return null;
    },
    [fetchProjects]
  );

  // Open terminal in project handler (shell session, not AI agent)
  const handleOpenTerminal = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      // Create a shell session with the project's working directory
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${project.name} Terminal`,
          workingDirectory: project.working_directory || "~",
          agentType: "shell",
          projectId,
        }),
      });

      const data = await res.json();
      if (!data.session) return;

      await fetchSessions();

      // Small delay to ensure state updates, then attach
      setTimeout(() => {
        attachToSession(data.session);
      }, 100);
      if (isMobile) setSidebarOpen(false);
    },
    [projects, fetchSessions, attachToSession, isMobile]
  );

  // Active session and dev server project
  const activeSession = sessions.find(
    (s) => s.id === focusedActiveTab?.sessionId
  );
  useScriptShortcuts(activeSession?.project_id, activeSession?.id);
  useFreshSessionCleanup(focusedActiveTab?.sessionId ?? undefined);
  const startDevServerProject = startDevServerProjectId
    ? (projects.find((p) => p.id === startDevServerProjectId) ?? null)
    : null;

  // View props
  const viewProps = {
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
    handleStartDevServer: startDevServer,
    handleCreateDevServer: createDevServer,
    startDevServerProject,
    setStartDevServerProjectId,
    renderPane,
  };

  return (
    <>
      {isMobile ? (
        <MobileView {...viewProps} />
      ) : (
        <DesktopView {...viewProps} />
      )}
      <SettingsPage
        settings={notificationSettings}
        permissionGranted={permissionGranted}
        onUpdateSettings={updateSettings}
        onRequestPermission={requestPermission}
      />
      <ScriptsSheetHost />
      <EdgeBack />
    </>
  );
}

export default function Home() {
  return (
    <PaneProvider>
      <HomeContent />
    </PaneProvider>
  );
}
