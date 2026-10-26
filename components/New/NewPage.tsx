"use client";

import { Loader2 } from "lucide-react";
import { PageHeader, type PageProps } from "@/components/WorkspacePage";
import { Button } from "@/components/ui/button";
import { backPage } from "@/stores/workspacePage";
import { NewForm } from "./NewForm";
import { useNewForm } from "./useNewForm";

/**
 * New as a page in the iOS app: the whole closed Duo, the right page of the
 * open one, with Start in the header (right of the fold)
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
    <>
      <PageHeader
        title="New"
        actions={
          <Button size="sm" onClick={form.submit} disabled={!form.canSubmit}>
            {form.busy && <Loader2 className="animate-spin" />}
            Start
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <NewForm
          form={form}
          projects={view.projects}
          canCreateProject
          className="mx-auto max-w-xl px-4 pt-4 pb-[max(1.5rem,var(--pane-inset-bottom,env(safe-area-inset-bottom)))]"
        />
      </div>
    </>
  );
}
