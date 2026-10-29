"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/lib/providers";
import type { ProjectWithDevServers } from "@/lib/projects";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  GLASS_DIALOG,
} from "@/components/ui/dialog";
import { DESKTOP_SIDEBAR_WIDTH } from "@/components/Sidebar";
import { useViewport } from "@/hooks/useViewport";
import { useLayoutMode, type LayoutMode } from "@/hooks/useLayoutMode";
import { mobileNavStore } from "@/stores/mobileNav";
import { closeNew, newSurfaceStore } from "@/stores/newSurface";
import { NewForm, StartPill } from "./NewForm";
import { NewScreen } from "./NewPage";
import { useNewForm, type NewFormState, type RunAs } from "./useNewForm";

interface NewSurfaceProps {
  open: boolean;
  projectId?: string;
  runAs?: RunAs;
  projects: ProjectWithDevServers[];
  onClose: () => void;
  onCreated: (sessionId: string) => void;
  onCreateProject?: (
    name: string,
    workingDirectory: string,
    agentType: AgentType
  ) => Promise<string | null>;
}

/** Postures where New fills the screen as a page rather than a dialog */
const SCREEN: LayoutMode[] = ["phone", "duo-closed", "tabletop"];

/**
 * A full-screen layer over the app: Esc closes it (unless a menu or dialog
 * on top takes it), and a keyboard goes straight to the task
 */
function Layer({
  form,
  label,
  autoFocus,
  className,
  style,
  children,
}: {
  form: NewFormState;
  label: string;
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const layer = ref.current;
    if (autoFocus) layer?.querySelector("textarea")?.focus();
    else layer?.focus({ preventScroll: true });
    // Capture: the terminal behind would swallow Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      if (!formRef.current.busy) formRef.current.handleClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [autoFocus]);

  return createPortal(
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={label}
      style={style}
      className={cn("bg-background fixed z-[45] outline-none", className)}
    >
      {children}
    </section>,
    document.body
  );
}

/**
 * New on the web. Desktop: D-New's centred column beside the sidebar.
 * Closed Duo, phone and tabletop: the page New is in the iOS app, with the
 * web column's Cancel | ✓ when it shows; the open Duo has it on the right
 * page. The book pose: the sized glass dialog (a sheet on touch), Start
 * always in reach.
 */
export function NewSurface({
  open,
  projectId,
  runAs,
  projects,
  onClose,
  onCreated,
  onCreateProject,
}: NewSurfaceProps) {
  // ui/dialog is a vaul sheet on touch
  const { isTouch } = useViewport();
  const mode = useLayoutMode();
  const { railWidth } = useSnapshot(mobileNavStore);
  const form = useNewForm({
    open,
    projects,
    selectedProjectId: projectId,
    runAs,
    onCreated,
    onClose,
    onCreateProject,
  });

  // The open Duo's web column sits in the page (SessionSpread), not fixed
  // over it: the layer stops at its left edge, so Cancel | ✓ stay in reach
  const [columnRight, setColumnRight] = useState(0);
  useEffect(() => {
    if (!open || mode !== "duo-open") return;
    const column = document.querySelector("[data-control-column]");
    setColumnRight(
      column
        ? Math.max(0, window.innerWidth - column.getBoundingClientRect().left)
        : 0
    );
  }, [open, mode]);

  if (mode === "desktop") {
    if (!open) return null;
    return (
      <Layer
        form={form}
        label="New session"
        autoFocus={!isTouch}
        className="inset-y-0 right-0 overflow-y-auto overscroll-contain"
        style={{ left: `var(--desktop-home-w, ${DESKTOP_SIDEBAR_WIDTH}px)` }}
      >
        <NewForm
          form={form}
          projects={projects}
          canCreateProject={!!onCreateProject}
          layout="wide"
          onCancel={form.handleClose}
          className="mx-auto w-full max-w-[768px] px-6 pt-24 pb-12"
        />
      </Layer>
    );
  }

  if (SCREEN.includes(mode) || mode === "duo-open") {
    if (!open) return null;
    return (
      <Layer
        form={form}
        label="New session"
        // Clear of the web column on the right, which stays usable; on the
        // open Duo it's the right page, Now staying on the left (a dialog
        // would cross the fold)
        className="inset-y-0 flex flex-col pt-[env(safe-area-inset-top)]"
        style={
          mode === "duo-open"
            ? {
                left: "calc(var(--hinge-x, 50%) + var(--fold-clear, 0px))",
                right: columnRight,
              }
            : { left: 0, right: railWidth }
        }
      >
        <NewScreen
          form={form}
          projects={projects}
          canCreateProject={!!onCreateProject}
          onClose={form.handleClose}
          columnNav={mode === "duo-open" ? columnRight > 0 : !!railWidth}
        />
      </Layer>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !form.busy && form.handleClose()}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          "flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-[560px]",
          // The sheet keeps its own side padding
          !isTouch && cn(GLASS_DIALOG, "p-0")
        )}
        onOpenAutoFocus={(e) => {
          // Straight to the task with a keyboard; a phone keeps its
          // keyboard down until a field is tapped
          if (isTouch) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement)
            .querySelector<HTMLTextAreaElement>("textarea")
            ?.focus();
        }}
        onKeyDown={(e) => {
          // The form handles its own; this catches the footer's buttons
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey) &&
            !e.defaultPrevented
          ) {
            e.preventDefault();
            void form.submit();
          }
        }}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-3 pb-3",
            !isTouch && "px-6 pt-5"
          )}
        >
          <DialogTitle className="t-title">
            {form.runAs === "background" ? "Background agent" : "New session"}
          </DialogTitle>
          {!isTouch && (
            <kbd className="border-border text-muted-foreground rounded border px-1 font-mono text-[11px]">
              esc
            </kbd>
          )}
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain",
            !isTouch && "px-6 pb-4"
          )}
        >
          <NewForm
            form={form}
            projects={projects}
            canCreateProject={!!onCreateProject}
            title={false}
            start={false}
          />
        </div>
        <div
          className={cn("flex shrink-0 gap-2 pt-3", !isTouch && "px-6 pb-5")}
        >
          {!isTouch && (
            <button
              type="button"
              onClick={form.handleClose}
              disabled={form.busy}
              className="pill pill-secondary h-[52px] rounded-[26px]"
            >
              Cancel
            </button>
          )}
          <StartPill form={form} className="flex-1" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** NewSurface as stores/newSurface.ts opens it, for every way into New */
export function NewSurfaceHost(
  props: Pick<NewSurfaceProps, "projects" | "onCreated" | "onCreateProject">
) {
  const { open, projectId, runAs } = useSnapshot(newSurfaceStore);
  return (
    <NewSurface
      {...props}
      open={open}
      projectId={projectId ?? undefined}
      runAs={runAs ?? undefined}
      onClose={closeNew}
    />
  );
}
