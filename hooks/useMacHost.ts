"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import {
  inspectorShown,
  isMacAction,
  isMacApp,
  macState,
  publishMacState,
  type MacAction,
} from "@/lib/mac-host";
import { runNav } from "@/lib/nav-actions";
import { useHereName, useMachines, useTabMachineId } from "@/data/machines";
import { useGitStatus } from "@/data/git/queries";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { loadMacHost, macHostStore, setMacInspector } from "@/stores/macHost";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { closeSettings, settingsPageStore } from "@/stores/settingsPage";
import {
  closePage,
  workspacePageStore,
  type WorkspacePageKind,
} from "@/stores/workspacePage";

/** Inside the Mac app; false on the server and the first render, so hydration matches */
export function useMacApp(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMacApp()), []);
  return mac;
}

/**
 * What the Mac window calls the machine it shows: the linked machine the
 * tab looks at, else this Mac's own AgentOS by its name, or "This Mac"
 */
export function useMacHereName(): string | null {
  const tab = useTabMachineId();
  const there = useHereName();
  const { data } = useMachines();
  if (tab) return there;
  if (!data) return null;
  return data.serverName?.trim() || "This Mac";
}

/** The inspector button, and the rail's own Hide: over Changes it is that view's */
export function toggleMacInspector() {
  const reviewing = mobileNavStore.viewMode === "git";
  setMacInspector(
    !inspectorShown(macHostStore, mobileNavStore.viewMode),
    reviewing
  );
}

const PAGE_TITLE: Record<WorkspacePageKind, string> = {
  project: "Project",
  new: "New chat",
  agent: "Background agent",
  projectSettings: "Project settings",
  inbox: "Needs you",
  running: "Running",
  mocks: "Mocks",
  runners: "Runners",
};

const VIEW_MODE = {
  chat: "chat",
  terminal: "terminal",
  changes: "git",
  files: "files",
  agents: "agents",
} as const;

interface MacHostOptions {
  session: Session | undefined;
  projects: { id: string; name: string; is_uncategorized?: boolean | number }[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  needs: number;
}

/**
 * Inside the Mac app: tells the window's toolbar what is in front (it reads
 * window.__agentosMac) and does what its buttons ask ("agentos-mac" events).
 * Nothing outside the Mac app.
 */
export function useMacHost({
  session,
  projects,
  sidebarOpen,
  setSidebarOpen,
  needs,
}: MacHostOptions) {
  const mac = useMacApp();
  const { viewMode, changes, agentCount } = useSnapshot(mobileNavStore);
  const { page } = useSnapshot(workspacePageStore);
  const { open: settingsOpen } = useSnapshot(settingsPageStore);
  const inspector = inspectorShown(useSnapshot(macHostStore), viewMode);
  const machine = useMacHereName();
  const titles = useListTitles(mac && session ? [session] : []);
  // The branch its folder is on (the pane asks for the same status)
  const { data: git } = useGitStatus(session?.working_directory ?? "", {
    enabled: mac && !!session,
  });
  const branch = git?.branch ?? session?.branch_name;

  useEffect(() => {
    if (mac) loadMacHost();
  }, [mac]);

  useEffect(() => {
    if (!mac) return;
    const act = (action: MacAction) => {
      if (action === "sidebar") setSidebarOpen(!sidebarOpen);
      else if (action === "inspector") toggleMacInspector();
      else if (action === "find") runNav("search");
      else if (action === "new") runNav("new");
      else if (action === "settings") runNav("settings");
      else {
        // A view picked over a page or Settings goes back to the session
        closeSettings();
        closePage();
        mobileNavActions.requestViewMode(VIEW_MODE[action]);
      }
    };
    const onEvent = (event: Event) => {
      const action = (event as CustomEvent<{ action?: unknown }>).detail
        ?.action;
      if (isMacAction(action)) act(action);
    };
    window.addEventListener("agentos-mac", onEvent);
    return () => window.removeEventListener("agentos-mac", onEvent);
  }, [mac, sidebarOpen, setSidebarOpen]);

  const project = session
    ? projects.find((p) => p.id === session.project_id)
    : undefined;
  const title = session ? displayTitle(session, titles).title : "";
  const covered = settingsOpen
    ? "Settings"
    : page
      ? PAGE_TITLE[page.kind]
      : null;

  useEffect(() => {
    if (!mac) return;
    const report = () =>
      publishMacState(
        macState({
          session: session ? { id: session.id, title, branch } : null,
          project: project && !project.is_uncategorized ? project.name : null,
          machine,
          covered,
          viewMode,
          changes,
          agents: agentCount,
          sidebar: sidebarOpen,
          inspector,
          dark: document.documentElement.classList.contains("dark"),
          needs,
        })
      );
    report();
    // Light or dark changed in Settings: the window follows
    const watcher = new MutationObserver(report);
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => watcher.disconnect();
  }, [
    mac,
    session,
    title,
    branch,
    project,
    machine,
    covered,
    viewMode,
    changes,
    agentCount,
    sidebarOpen,
    inspector,
    needs,
  ]);
}
