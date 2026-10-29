"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSnapshot } from "valtio";
import type { ProjectWithDevServers } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { isNative, nativeCaps } from "@/lib/native-bridge";
import type { PageProps } from "@/components/WorkspacePage";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { postureStore } from "@/stores/posture";
import { backPage } from "@/stores/workspacePage";
import { NewForm, StartPill } from "./NewForm";
import { useNewForm, type NewFormState } from "./useNewForm";

interface NewScreenProps {
  form: NewFormState;
  projects: ProjectWithDevServers[];
  canCreateProject?: boolean;
  onClose: () => void;
  /** The column draws Cancel and ✓ (E-New); else the screen has its X */
  columnNav: boolean;
}

/**
 * New filling its space (E-New, N-PermNew): the whole closed Duo or phone,
 * the open Duo's right page. Tabletop keeps the form above the fold and
 * Start on the base.
 */
export function NewScreen({
  form,
  projects,
  canCreateProject,
  onClose,
  columnNav,
}: NewScreenProps) {
  const mode = useLayoutMode();
  const { fold } = useSnapshot(postureStore);
  const tabletop = mode === "tabletop" && fold?.axis === "horizontal";
  const ref = useRef<HTMLDivElement>(null);
  // The fold is in viewport pixels; the screen may start below the top
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (tabletop) setTop(ref.current?.getBoundingClientRect().top ?? 0);
  }, [tabletop]);

  const gutters = columnNav ? "pr-2 pl-5" : "px-5";
  const body = (
    <NewForm
      form={form}
      projects={projects}
      canCreateProject={canCreateProject}
      start={!tabletop}
      className={cn(gutters, "pt-[18px]")}
    />
  );

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {!columnNav && (
        <div className="shrink-0 px-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={form.busy}
            aria-label="Cancel"
            className="text-muted-foreground active:bg-accent hover:bg-accent grid h-9 w-9 place-items-center rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      {tabletop && fold ? (
        <>
          <div
            className="min-h-0 shrink-0 overflow-y-auto overscroll-contain pb-4"
            style={{ height: Math.max(0, fold.start - top) }}
          >
            {body}
          </div>
          <div
            className={cn(gutters, "shrink-0")}
            style={{ paddingTop: fold.end - fold.start + 16 }}
          >
            <StartPill form={form} />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1.5rem+max(env(safe-area-inset-bottom),var(--pane-inset-bottom,0px)))]">
          {body}
        </div>
      )}
    </div>
  );
}

/**
 * New as a page in the iOS app: the whole closed Duo, the right page of the
 * open one
 */
export function NewPage({ page, view }: PageProps<"new">) {
  const form = useNewForm({
    projects: view.projects,
    selectedProjectId: page.projectId,
    runAs: page.runAs === "agent" ? "background" : page.runAs,
    // Opening the session closes the page
    onCreated: view.handleSessionCreated,
    // A background agent's toast says it started; back to where New was
    onStarted: backPage,
    onClose: backPage,
    onCreateProject: view.handleCreateProject,
  });

  return (
    <NewScreen
      form={form}
      projects={view.projects}
      canCreateProject
      onClose={form.handleClose}
      // Builds that draw the column from the spec show Cancel | ✓
      columnNav={isNative() && nativeCaps().column}
    />
  );
}
