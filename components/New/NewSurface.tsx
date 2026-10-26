"use client";

import { Loader2 } from "lucide-react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/lib/providers";
import type { ProjectWithDevServers } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useViewport } from "@/hooks/useViewport";
import { closeNew, newSurfaceStore } from "@/stores/newSurface";
import { NewForm } from "./NewForm";
import { useNewForm, type RunAs } from "./useNewForm";

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

/**
 * New on the web: a sized glass dialog, keyboard first (Esc, ⌘↵), or the
 * bottom sheet with Start always in reach on touch phones. The iOS app
 * shows NewPage instead.
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
  const form = useNewForm({
    open,
    projects,
    selectedProjectId: projectId,
    runAs,
    onCreated,
    onClose,
    onCreateProject,
  });

  const start = (
    <Button
      onClick={form.submit}
      disabled={!form.canSubmit}
      className={isTouch ? "h-12 w-full rounded-2xl" : undefined}
    >
      {form.busy && <Loader2 className="animate-spin" />}
      Start
      {!isTouch && (
        <kbd className="rounded border border-current/30 px-1 font-mono text-[11px] font-normal opacity-70">
          ⌘↵
        </kbd>
      )}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !form.busy && form.handleClose()}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          "flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]",
          !isTouch &&
            "bg-background/80 rounded-2xl shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08),0_24px_60px_rgb(0_0_0/0.45)] backdrop-blur-xl backdrop-saturate-150"
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
            form.submit();
          }
        }}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-3 pb-3",
            !isTouch && "px-6 pt-5"
          )}
        >
          <DialogTitle className={isTouch ? "text-xl" : "text-lg"}>
            New
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
          />
        </div>
        {isTouch ? (
          <div className="shrink-0 pt-3">{start}</div>
        ) : (
          <div className="border-border flex shrink-0 items-center justify-between gap-2 border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={form.handleClose}
              disabled={form.busy}
            >
              Cancel
            </Button>
            {start}
          </div>
        )}
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
