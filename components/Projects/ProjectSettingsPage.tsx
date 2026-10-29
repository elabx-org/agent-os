"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, Loader2, Plus } from "lucide-react";
import { SectionTitle } from "@/components/a/SectionTitle";
import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";
import { useProjectsQuery } from "@/data/projects";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode, type LayoutMode } from "@/hooks/useLayoutMode";
import { nativeCaps } from "@/lib/native-bridge";
import type { ProjectScript } from "@/lib/project-config-types";
import type { ProjectWithRepositories } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { backPage } from "@/stores/workspacePage";
import { ConfigPreview } from "./ConfigPreview";
import {
  ProjectConfigEditor,
  previewBase,
  useProjectConfigEditor,
  type ScriptEdit,
} from "./ProjectConfigEditor";
import { upsertScript } from "./ProjectConfigText";
import {
  ProjectSettingsFolderPicker,
  ProjectSettingsForm,
  useProjectSettingsForm,
} from "./ProjectSettingsForm";

const FORM_ID = "project-settings-form";

/** As the Project page (Closed-Project): clear of the closed Duo's column */
const PAD: Record<LayoutMode, string> = {
  phone: "px-4 pt-[15px]",
  "duo-closed": "pt-[14px] pr-2 pl-5",
  tabletop: "px-4 pt-4",
  "duo-open": "pt-5 pr-5 pl-6",
  book: "pt-5 pr-5 pl-6",
  desktop: "pt-[22px] pr-7 pl-7",
};

function home(dir: string): string {
  return dir.replace(/^\/config(?=\/|$)/, "~");
}

/**
 * Project settings as a page (N-Config; D-Config with the file beside it
 * where there's room): the repo's `.agent-os.json` first, then what
 * Agent-OS keeps for the project (repositories, dev servers, hooks,
 * instructions), which has its own Save
 */
export function ProjectSettingsPage({ page }: PageProps<"projectSettings">) {
  const { data: projects, isLoading } = useProjectsQuery();
  const live = projects?.find((p) => p.id === page.projectId) ?? null;
  const mode = useLayoutMode();
  const native = useIsNative();

  // The project as the page opened: a refetch mustn't reset the edits
  const [project, setProject] = useState<ProjectWithRepositories | null>(live);
  if (!project && live) setProject(live);

  const form = useProjectSettingsForm(project, true);
  const editor = useProjectConfigEditor(page.projectId);
  const [scriptEdit, setScriptEdit] = useState<ScriptEdit | null>(null);
  const [draft, setDraft] = useState<ProjectScript | null>(null);
  const [saved, setSaved] = useState(false);

  const file = editor.file;
  const preview = useMemo(
    () =>
      file && draft ? upsertScript(file, draft, scriptEdit?.script?.id) : file,
    [file, draft, scriptEdit?.script?.id]
  );

  if (!project) {
    return (
      <>
        <PageHeader title="Project settings" />
        <PageEmpty>{isLoading ? null : "This project is gone."}</PageEmpty>
      </>
    );
  }

  const submit = async () => {
    setSaved(false);
    if (await form.save()) setSaved(true);
  };

  // Back where no column or bar holds it (as PageHeader's large title)
  const back =
    mode !== "duo-open" &&
    mode !== "book" &&
    (native ? !nativeCaps().column : mode === "phone" || mode === "desktop");
  const wide = mode === "desktop";
  const ready = editor.status === "ready";

  return (
    <div className="@container/settings flex min-h-0 flex-1">
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1.5rem,var(--pane-inset-bottom,env(safe-area-inset-bottom)))]",
          PAD[mode]
        )}
      >
        <div className="flex max-w-[760px] flex-col gap-3.5">
          <header className="flex shrink-0 flex-col">
            {back && (
              <button
                type="button"
                onClick={backPage}
                aria-label="Back"
                className="text-muted-foreground active:bg-accent mb-1 -ml-2 flex h-[44px] w-[44px] items-center justify-center rounded-full"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <div className="flex min-w-0 items-end justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-muted-foreground truncate",
                    wide ? "font-mono text-[12px]" : "text-[13px]"
                  )}
                >
                  {wide ? home(project.working_directory) : project.name}
                </p>
                <h1 className="t-title mt-0.5">Project settings</h1>
              </div>
              <button
                type="button"
                disabled={!ready}
                onClick={() => setScriptEdit({})}
                className={cn(
                  "pill flex-none active:opacity-80 disabled:opacity-40",
                  wide ? "pill-sm pill-primary" : "pill-secondary px-3.5"
                )}
              >
                <Plus className="h-4 w-4" strokeWidth={2.4} />
                Add script
              </button>
            </div>
          </header>

          <ProjectConfigEditor
            editor={editor}
            projectName={project.name}
            scriptEdit={scriptEdit}
            onScriptEdit={setScriptEdit}
            onDraft={setDraft}
          />

          <section className="mt-4 flex min-w-0 flex-col gap-1.5">
            <SectionTitle>In Agent-OS</SectionTitle>
            <p className="text-muted-foreground px-1 text-[13px]">
              Kept by Agent-OS for this project, not in the repo.
            </p>
            <ProjectSettingsForm
              form={form}
              id={FORM_ID}
              onSubmit={submit}
              className="pt-3"
            >
              <div className="flex flex-wrap items-center justify-end gap-3">
                {form.error && (
                  <p role="alert" className="mr-auto text-sm text-red-500">
                    {form.error}
                  </p>
                )}
                {saved && !form.error && !form.isLoading && (
                  <span
                    role="status"
                    className="text-muted-foreground mr-auto flex items-center gap-1.5 text-[13px]"
                  >
                    <Check className="h-4 w-4 text-[hsl(var(--work))]" />
                    Saved
                  </span>
                )}
                <button
                  type="submit"
                  disabled={form.isLoading}
                  className="pill pill-primary active:opacity-80 disabled:opacity-50"
                >
                  {form.isLoading && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Save
                </button>
              </div>
            </ProjectSettingsForm>
          </section>
        </div>
      </div>

      {ready && preview && editor.res && (
        // D-Config's panel; above the Add script dialog's dim, so the
        // lines it adds show as they're typed
        <aside
          aria-label=".agent-os.json preview"
          className={cn(
            "border-border hidden w-[440px] flex-none flex-col overflow-hidden border-l py-5 pl-2 @[1100px]/settings:flex",
            scriptEdit && "relative z-[60]"
          )}
        >
          <ConfigPreview
            base={previewBase(editor.res, editor.file!)}
            config={preview}
            className="min-h-0 flex-1"
          />
        </aside>
      )}

      {form.folderPickerRepoId && (
        // A dialog to the page host, so Esc doesn't leave the page under it
        <div role="dialog" aria-modal="true" aria-label="Choose a folder">
          <ProjectSettingsFolderPicker form={form} />
        </div>
      )}
    </div>
  );
}
