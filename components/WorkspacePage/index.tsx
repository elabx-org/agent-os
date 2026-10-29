"use client";

import { useEffect, useRef, type ComponentType } from "react";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import type { ViewProps } from "@/components/views/types";
import { backPage, workspacePageStore } from "@/stores/workspacePage";
import { cn } from "@/lib/utils";
import { runNav } from "@/lib/nav-actions";
import { PAGES, type PageProps } from "./pages";
import { PageEdge } from "@/components/ui/page-edge";

export { PageHeader, PageEmpty } from "./PageHeader";
export type { PageProps } from "./pages";

interface WorkspacePageProps {
  view: ViewProps;
  onOpenSession: (session: Session) => void;
  className?: string;
}

/** The open workspace page (stores/workspacePage.ts), or nothing */
export function WorkspacePage({
  view,
  onOpenSession,
  className,
}: WorkspacePageProps) {
  const { page } = useSnapshot(workspacePageStore);
  const ref = useRef<HTMLDivElement>(null);
  const kind = page?.kind;

  // Off the terminal (and the iOS keyboard) so keys and Esc land here
  useEffect(() => {
    if (kind) ref.current?.focus({ preventScroll: true });
  }, [kind]);

  // Esc goes back, unless a dialog or sheet on top takes it, or something
  // outside the page (the home's search) has focus
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      const active = document.activeElement;
      if (active && active !== document.body && !ref.current?.contains(active))
        return;
      e.preventDefault();
      backPage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind]);

  if (!page) return null;
  const Page = PAGES[page.kind] as ComponentType<PageProps>;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={cn(
        "bg-background relative flex h-full min-h-0 flex-col outline-none",
        className
      )}
    >
      <PageEdge label="Back" onClose={() => runNav("back")} />
      <Page
        // A new subject starts fresh (another project, another agent)
        key={JSON.stringify(page)}
        page={page as PageProps["page"]}
        view={view}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}
