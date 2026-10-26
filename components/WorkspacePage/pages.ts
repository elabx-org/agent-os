import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { Session } from "@/lib/db";
import type { ViewProps } from "@/components/views/types";
import type { WorkspacePage, WorkspacePageKind } from "@/stores/workspacePage";

export interface PageProps<K extends WorkspacePageKind = WorkspacePageKind> {
  page: Extract<WorkspacePage, { kind: K }>;
  /** What the views have: sessions, projects, statuses and their handlers */
  view: ViewProps;
  /** Opens a session the way this view does (a phone leaves the home too) */
  onOpenSession: (session: Session) => void;
}

/** Each kind loads only when first opened */
export const PAGES: { [K in WorkspacePageKind]: ComponentType<PageProps<K>> } =
  {
    project: dynamic(
      () => import("@/components/ProjectPage").then((m) => m.ProjectPage),
      { ssr: false }
    ),
    new: dynamic(
      () => import("@/components/New/NewPage").then((m) => m.NewPage),
      { ssr: false }
    ),
    agent: dynamic(
      () =>
        import("@/components/BackgroundAgents/AgentDetail").then(
          (m) => m.AgentDetailPage
        ),
      { ssr: false }
    ),
    projectSettings: dynamic(
      () =>
        import("@/components/Projects/ProjectSettingsPage").then(
          (m) => m.ProjectSettingsPage
        ),
      { ssr: false }
    ),
    inbox: dynamic(
      () =>
        import("@/components/Notifications/NeedsYouPage").then(
          (m) => m.NeedsYouPage
        ),
      { ssr: false }
    ),
  };
