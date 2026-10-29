"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ChevronRight,
  GitBranch,
  Globe,
  Pencil,
  Plus,
  Shield,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { SectionTitle } from "@/components/a/SectionTitle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ProjectConfigError,
  projectConfigKeys,
  useProjectConfig,
  useSaveProjectConfig,
} from "@/hooks/useProjectConfig";
import { useViewport } from "@/hooks/useViewport";
import { refusalText } from "@/lib/client/user-fetch";
import { MODES, MODE_LABELS, type Mode } from "@/lib/permission-mode";
import {
  CONFIG_FILE,
  LEGACY_CONFIG_FILE,
  type AgentOsConfig,
  type ProjectConfigResponse,
  type ProjectScript,
} from "@/lib/project-config-types";
import { cn } from "@/lib/utils";
import { AddScriptDialog } from "./AddScriptDialog";
import { ConfigPreview } from "./ConfigPreview";
import {
  AgentDialog,
  ChoiceDialog,
  TextDialog,
  agentLabel,
} from "./ProjectConfigDialogs";
import { ShortcutChip, StepList } from "./ProjectConfigParts";
import {
  fileConfig,
  legacyMoved,
  listScripts,
  mergeLegacy,
  parseSteps,
  removeScript,
  serializeConfig,
  setKey,
  stepsLabel,
  upsertScript,
  withDefaults,
} from "./ProjectConfigText";
import { ScriptIcon } from "./ScriptIcon";

/** A refused save in words */
function saveError(err: unknown): string {
  if (err instanceof ProjectConfigError) {
    if (err.status === 409)
      return `${CONFIG_FILE} changed on disk, so nothing was saved. This shows the new version; make your change again.`;
    if (err.status === 403) return refusalText(err.body);
    if (err.status === 501 || err.status === 404)
      return "This server can't save project config yet.";
    return refusalText(err.body);
  }
  return "Couldn't save. Check the connection and try again.";
}

export type ConfigEditorStatus =
  | "loading"
  | "unavailable"
  | "invalid"
  | "ready";

/**
 * `.agent-os.json` for the settings page: the response, the file's own
 * content to edit, and `save`, which PUTs with the hash the edit started
 * from and throws a sentence on refusal (a 409 also refetches)
 */
export function useProjectConfigEditor(projectId: string) {
  const qc = useQueryClient();
  const query = useProjectConfig(projectId);
  const put = useSaveProjectConfig(projectId);
  const [notice, setNotice] = useState<string | null>(null);

  const res = query.data;
  const file = useMemo(() => (res ? fileConfig(res) : null), [res]);
  const scripts = useMemo(() => (file ? listScripts(file) : []), [file]);

  const status: ConfigEditorStatus = query.isLoading
    ? "loading"
    : !res
      ? "unavailable"
      : !file
        ? "invalid"
        : "ready";

  const save = useCallback(
    async (next: AgentOsConfig, opts: { allowFullAccess?: boolean } = {}) => {
      if (!res) throw new Error("This server can't save project config yet.");
      setNotice(null);
      try {
        await put.mutateAsync({
          config: next,
          baseHash: res.hash,
          ...(opts.allowFullAccess !== undefined && {
            allowFullAccess: opts.allowFullAccess,
          }),
        });
      } catch (err) {
        const text = saveError(err);
        if (err instanceof ProjectConfigError && err.status === 409) {
          setNotice(text);
          await qc.refetchQueries({
            queryKey: projectConfigKeys.config(projectId),
          });
        }
        throw new Error(text);
      }
    },
    [res, put, qc, projectId]
  );

  return { status, res, file, scripts, save, notice, setNotice };
}

export type ProjectConfigEditorState = ReturnType<
  typeof useProjectConfigEditor
>;

/** What the page's preview shows while a script is being edited */
export interface ScriptEdit {
  /** The script being edited; none for Add script */
  script?: ProjectScript;
}

type Picker = "preview" | "agent" | "mode" | "setup" | "file" | null;

const MODE_DETAIL: Record<Mode, string> = {
  manual: "Asks before edits and commands",
  acceptEdits: "Edits files, asks before commands",
  auto: "Works on its own, stops for risky steps",
  bypassPermissions: "Never asks. Only for sessions you trust",
};

/**
 * N-Config / D-Config: scripts, Preview URL, default agent, permission
 * mode and worktree setup, all in `.agent-os.json`. The page holds the
 * script dialog (its header has + Add script) and the preview panel.
 */
export function ProjectConfigEditor({
  editor,
  projectName,
  scriptEdit,
  onScriptEdit,
  onDraft,
}: {
  editor: ProjectConfigEditorState;
  projectName: string;
  /** The Add script dialog: open for a script, or new; null when closed */
  scriptEdit: ScriptEdit | null;
  onScriptEdit: (edit: ScriptEdit | null) => void;
  /** The dialog's draft, for the preview */
  onDraft: (draft: ProjectScript | null) => void;
}) {
  const { status, res, file, scripts, save, notice } = editor;
  const [picker, setPicker] = useState<Picker>(null);

  if (status === "loading")
    return (
      <p className="text-muted-foreground px-1 py-6 text-[15px]">
        Reading {CONFIG_FILE}…
      </p>
    );
  if (status === "unavailable" || !res)
    return (
      <div className="group-card text-muted-foreground px-4 py-4 text-[15px]">
        Scripts and {CONFIG_FILE} aren&apos;t available on this server yet.
      </div>
    );
  if (status === "invalid" || !file)
    return (
      <div className="group-card px-4 py-4 text-[15px]">
        <p>
          <span className="font-mono text-[14px]">{CONFIG_FILE}</span> in{" "}
          {projectName} isn&apos;t a JSON object, so it can&apos;t be edited
          here. Fix it in the repo and come back.
        </p>
      </div>
    );

  const legacy = res.legacy;
  const legacyIsSource = !!legacy?.setup?.length;
  const moved = legacy ? legacyMoved(file, legacy) : false;
  const steps = legacyIsSource ? (legacy?.setup ?? []) : (file.setup ?? []);
  const fileMode = file.defaults?.permissionMode;
  const modeBlocked =
    fileMode === "bypassPermissions" &&
    res.defaults.permissionMode !== "bypassPermissions";
  const agentValue = agentLabel(file.defaults?.agent, file.defaults?.model);

  const editScript = (script?: ProjectScript) => onScriptEdit({ script });

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      {notice && (
        <p
          role="status"
          className="status-card tone-needs h-auto px-3 py-2.5 text-[14px]"
        >
          {notice}
        </p>
      )}

      <section className="flex min-w-0 flex-col gap-1.5">
        <SectionTitle>
          {scripts.length ? `Scripts · ${scripts.length}` : "Scripts"}
        </SectionTitle>
        {scripts.length === 0 ? (
          <div className="group-card flex flex-col items-start gap-3 px-4 py-4">
            <p className="text-muted-foreground text-[15px]">
              No scripts yet. Add the commands you run often, like tests, a dev
              server or a deploy, and run them from any session.
            </p>
            <button
              type="button"
              onClick={() => editScript()}
              className="pill pill-sm pill-secondary active:opacity-70"
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} />
              Add script
            </button>
          </div>
        ) : (
          <>
            {/* Narrow: N-Config's rows */}
            <div
              role="group"
              aria-label="Scripts"
              className="group-card @3xl/settings:hidden"
            >
              {scripts.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => editScript(s)}
                  aria-label={`Edit ${s.name}`}
                  className="row active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 min-h-[46px] w-full gap-[11px] px-3 py-1.5 text-left"
                >
                  <ScriptIcon icon={s.icon} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{s.name}</span>
                    <span className="text-muted-foreground block truncate font-mono text-[12px]">
                      {s.command}
                    </span>
                  </span>
                  {s.shortcut ? (
                    <ShortcutChip text={s.shortcut} />
                  ) : (
                    <span className="text-muted-foreground flex-none text-[12px]">
                      No shortcut
                    </span>
                  )}
                  <ChevronRight
                    aria-hidden
                    className="h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]"
                  />
                </button>
              ))}
            </div>

            {/* Wide: D-Config's table */}
            <div
              role="table"
              aria-label="Scripts"
              className="group-card hidden px-1 pt-1 @3xl/settings:grid @3xl/settings:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_130px_110px_52px]"
            >
              <div role="row" className="contents">
                {["Name", "Command", "Runs in", "Shortcut", ""].map((h, i) => (
                  <div
                    key={i}
                    role="columnheader"
                    className="text-muted-foreground flex h-9 items-center px-3 text-[12px] font-semibold"
                  >
                    {h && h}
                    {!h && <span className="sr-only">Edit</span>}
                  </div>
                ))}
              </div>
              {scripts.map((s) => (
                <div key={s.id} role="row" className="contents">
                  <div role="cell" className={CELL}>
                    <ScriptIcon icon={s.icon} size={28} />
                    <span className="truncate">{s.name}</span>
                  </div>
                  <div
                    role="cell"
                    className={cn(CELL, "font-mono text-[13px]")}
                  >
                    <span className="truncate">{s.command}</span>
                  </div>
                  <div
                    role="cell"
                    className={cn(CELL, "text-muted-foreground")}
                  >
                    {s.in === "background" ? "Background" : "Session terminal"}
                  </div>
                  <div role="cell" className={CELL}>
                    {s.shortcut ? (
                      <ShortcutChip text={s.shortcut} />
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </div>
                  <div role="cell" className={cn(CELL, "px-1")}>
                    <button
                      type="button"
                      onClick={() => editScript(s)}
                      aria-label={`Edit ${s.name}`}
                      className="text-muted-foreground hover:bg-accent flex h-9 w-9 items-center justify-center rounded-full"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-1.5">
        <SectionTitle className="hidden @3xl/settings:flex">
          Project
        </SectionTitle>
        <div role="group" aria-label="Project" className="group-card">
          <ValueRow
            icon={<Globe className="h-[18px] w-[18px]" />}
            label="Preview URL"
            value={
              file.previewUrl ? (
                <span className="font-mono text-[12px]">{file.previewUrl}</span>
              ) : (
                "None"
              )
            }
            onClick={() => setPicker("preview")}
          />
          <ValueRow
            icon={
              <Avatar
                {...agentAvatar(file.defaults?.agent)}
                size="sm"
                className="h-[18px] w-[18px] rounded-[5px] text-[9px]"
              />
            }
            label="Default agent"
            value={agentValue ?? "Agent-OS default"}
            onClick={() => setPicker("agent")}
          />
          <ValueRow
            icon={<Shield className="h-[18px] w-[18px]" />}
            label="Permission mode"
            value={
              fileMode ? (
                modeBlocked ? (
                  <span className="text-[hsl(var(--needs))]">
                    Full access, not allowed
                  </span>
                ) : (
                  MODE_LABELS[fileMode]
                )
              ) : (
                "Agent's default"
              )
            }
            onClick={() => setPicker("mode")}
          />
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setPicker("setup")}
          className="group-card active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 flex w-full flex-col gap-1.5 px-3 pt-2 pb-2.5 text-left"
        >
          <span className="flex w-full items-center gap-2">
            <GitBranch
              aria-hidden
              className="text-muted-foreground h-[18px] w-[18px] flex-none"
            />
            <span className="min-w-0 flex-1 truncate text-[15px]">
              When a worktree is created
            </span>
            <span className="text-muted-foreground flex-none text-[13px]">
              {stepsLabel(steps.length)}
            </span>
            <ChevronRight
              aria-hidden
              className="h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]"
            />
          </span>
          {steps.length > 0 ? (
            <StepList steps={steps} className="w-full" />
          ) : (
            <span className="text-muted-foreground text-[13px]">
              Commands to run in each new worktree, like npm install.
            </span>
          )}
        </button>
        {legacy && legacyIsSource && (
          <div className="flex flex-wrap items-center gap-2 px-1 text-[13px]">
            <span className="text-muted-foreground min-w-0 flex-1">
              {moved ? (
                <>
                  Setup steps still come from{" "}
                  <span className="font-mono">{LEGACY_CONFIG_FILE}</span>, which
                  is read first. Delete it to edit them here.
                </>
              ) : (
                <>
                  Setup steps come from{" "}
                  <span className="font-mono">{LEGACY_CONFIG_FILE}</span>
                </>
              )}
            </span>
            {!moved && (
              <MoveLegacy onMove={() => save(mergeLegacy(file, legacy))} />
            )}
          </div>
        )}
      </section>

      <p className="text-muted-foreground px-1 text-[13px] leading-snug">
        Saved to{" "}
        <span className="text-foreground/90 font-mono">{CONFIG_FILE}</span> in{" "}
        {projectName}, so every device and agent sees it.{" "}
        <button
          type="button"
          onClick={() => setPicker("file")}
          className="text-violet-700 underline-offset-2 hover:underline @[1100px]/settings:hidden dark:text-violet-300"
        >
          View file
        </button>
      </p>

      <AddScriptDialog
        open={!!scriptEdit}
        onOpenChange={(o) => !o && onScriptEdit(null)}
        initial={scriptEdit?.script}
        scripts={scripts}
        setup={steps}
        onDraftChange={onDraft}
        onSave={(script) =>
          save(upsertScript(file, script, scriptEdit?.script?.id))
        }
        onDelete={
          scriptEdit?.script
            ? () => save(removeScript(file, scriptEdit.script!.id))
            : undefined
        }
      />

      <TextDialog
        open={picker === "preview"}
        onOpenChange={(o) => !o && setPicker(null)}
        title="Preview URL"
        description="Where the app runs while you work on it. Open preview and agents use it."
        label="URL"
        initial={file.previewUrl ?? ""}
        placeholder="http://localhost:3000"
        onSave={(v) => save(setKey(file, "previewUrl", v || undefined))}
      />

      <AgentDialog
        open={picker === "agent"}
        onOpenChange={(o) => !o && setPicker(null)}
        agent={file.defaults?.agent}
        model={file.defaults?.model}
        onSave={(agent, model) =>
          save(
            withDefaults(file, {
              agent: agent || undefined,
              model: agent ? model || undefined : undefined,
            })
          )
        }
      />

      <ChoiceDialog<Mode | "">
        open={picker === "mode"}
        onOpenChange={(o) => !o && setPicker(null)}
        title="Permission mode"
        description={
          modeBlocked
            ? "The file asks for Full access. It only applies once you choose it here yourself."
            : "How much a new session may do without asking."
        }
        value={modeBlocked ? "" : (fileMode ?? "")}
        options={[
          { value: "", label: "Agent's default" },
          ...MODES.map((m) => ({
            value: m,
            label: MODE_LABELS[m],
            detail: MODE_DETAIL[m],
          })),
        ]}
        onChoose={(m) =>
          save(withDefaults(file, { permissionMode: m || undefined }), {
            allowFullAccess: m === "bypassPermissions",
          })
        }
      />

      <TextDialog
        open={picker === "setup"}
        onOpenChange={(o) => !o && setPicker(null)}
        title="When a worktree is created"
        description={
          legacyIsSource
            ? `These come from ${LEGACY_CONFIG_FILE}, which is read first. Saving here writes ${CONFIG_FILE}; delete the old file for these to apply.`
            : "One command per line, run in order in each new worktree."
        }
        label="Steps"
        multiline
        initial={steps.join("\n")}
        placeholder={"npm install\ncp .env.example .env"}
        onSave={(v) => save(setKey(file, "setup", parseSteps(v)))}
      />

      <FileDialog
        open={picker === "file"}
        onOpenChange={(o) => !o && setPicker(null)}
        res={res}
        config={file}
      />
    </div>
  );
}

/**
 * The preview's base: the file as the editor would write it unchanged, so
 * only pending edits are marked (not a different indent on disk); nothing
 * when there's no file yet, so every line is one to add
 */
export function previewBase(
  res: Pick<ProjectConfigResponse, "exists">,
  file: AgentOsConfig
): string {
  return res.exists ? serializeConfig(file) : "";
}

const CELL =
  "flex h-[52px] min-w-0 items-center gap-2.5 border-t border-[var(--hair)] px-3 text-[14px]";

function ValueRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 min-h-[46px] w-full gap-[11px] px-3 py-1.5 text-left @3xl/settings:min-h-[52px]"
    >
      <span
        aria-hidden
        className="text-muted-foreground flex w-[18px] flex-none justify-center"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      <span className="text-muted-foreground min-w-0 truncate text-[14px]">
        {value}
      </span>
      <ChevronRight
        aria-hidden
        className="h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]"
      />
    </button>
  );
}

function MoveLegacy({ onMove }: { onMove: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onMove();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't move them");
          } finally {
            setBusy(false);
          }
        }}
        className="pill pill-sm pill-secondary flex-none active:opacity-70 disabled:opacity-50"
      >
        Move to {CONFIG_FILE}
      </button>
      {error && (
        <p role="alert" className="w-full text-[13px] text-red-500">
          {error}
        </p>
      )}
    </>
  );
}

/** The column's "View .agent-os.json" where the panel doesn't fit */
function FileDialog({
  open,
  onOpenChange,
  res,
  config,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  res: ProjectConfigResponse;
  config: AgentOsConfig;
}) {
  const { isTouch } = useViewport();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[88vh] flex-col gap-3 overflow-hidden sm:max-w-[560px]",
          !isTouch && "rounded-[28px] border-0 bg-[var(--sheet)] py-6 pr-0 pl-4"
        )}
      >
        <DialogTitle className="sr-only">{CONFIG_FILE}</DialogTitle>
        <DialogDescription className="sr-only">
          The file as it is in the repo
        </DialogDescription>
        <ConfigPreview
          base={previewBase(res, config)}
          config={config}
          className="min-h-0 flex-1 [&>pre]:max-h-[70vh]"
        />
      </DialogContent>
    </Dialog>
  );
}
