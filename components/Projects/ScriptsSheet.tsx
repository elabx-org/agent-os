"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { StateDot } from "@/components/a/StateDot";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useProjectsQuery } from "@/data/projects";
import { useLayoutMode, type LayoutMode } from "@/hooks/useLayoutMode";
import { FOLD_CLEAR } from "@/hooks/useHinge";
import {
  useProjectConfig,
  useScriptRunLog,
  useScriptRuns,
  useStopScriptRun,
} from "@/hooks/useProjectConfig";
import { isMacLike } from "@/hooks/useViewShortcuts";
import { CONFIG_FILE } from "@/lib/project-config-types";
import { formatShortcut, parseShortcut } from "@/lib/script-shortcuts";
import { cn } from "@/lib/utils";
import { mobileNavStore } from "@/stores/mobileNav";
import { openProjectSettings } from "@/stores/projectSettings";
import { closeScripts, useScriptsSheet } from "@/stores/scriptsSheet";
import { registerNavHandlers } from "@/lib/nav-actions";
import { requestTerminalRun } from "@/stores/scriptTerminal";
import { LogTail, RoundButton, ScriptRow, useNow } from "./ScriptParts";
import { ScriptIcon } from "./ScriptIcon";
import {
  lastRunText,
  previewPort,
  previewScriptId,
  runningText,
  splitScripts,
  stripAnsi,
  type ScriptEntry,
} from "./script-view";
import { stopErrorText, useScriptRunner } from "./useScriptRunner";

/** Postures where Scripts is a centred dialog rather than a bottom sheet */
const CENTRED: LayoutMode[] = ["desktop", "duo-open"];

/** How much of a background run "Show output" loads */
const OUTPUT_LINES = 400;

type TitleSlot = (text: string) => ReactNode;

/** "Show output" of a background run: its whole log, kept current */
function OutputPage({
  entry,
  title,
  onBack,
}: {
  entry: ScriptEntry;
  title: TitleSlot;
  onBack: () => void;
}) {
  const run = entry.run!;
  const { data, isLoading } = useScriptRunLog(run.id, {
    lines: OUTPUT_LINES,
    live: run.status === "running",
  });
  const scroller = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to scripts"
          className="text-primary active:bg-accent -ml-2 grid h-11 w-11 flex-none place-items-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">{title(entry.script.name)}</div>
        <span className="text-muted-foreground truncate font-mono text-[12px]">
          {entry.script.command}
        </span>
      </div>
      <pre
        ref={scroller}
        aria-label={`${entry.script.name} output`}
        className="min-h-[12rem] flex-1 overflow-auto rounded-xl bg-[var(--block)] px-3 py-2 font-mono text-[12px] leading-[1.6] whitespace-pre text-[#3A3A3C] dark:text-[#C7C7CC]"
      >
        {data?.length
          ? data.map(stripAnsi).join("\n")
          : isLoading
            ? "…"
            : "No output yet"}
      </pre>
    </div>
  );
}

/** A running script: N-Scripts' card with the tail of its log */
function RunningCard({
  entry,
  previewUrl,
  now,
  stopping,
  onStop,
  onShowOutput,
}: {
  entry: ScriptEntry;
  /** Set on the script that serves the preview */
  previewUrl: string | null;
  now: number;
  stopping: boolean;
  onStop: () => void;
  /** null when there's nothing to show (a terminal run of another session) */
  onShowOutput: (() => void) | null;
}) {
  const { script, run } = entry;
  const background = !!run!.log_path;
  const parts = runningText(
    run!,
    previewUrl ? previewPort(previewUrl) : null,
    now
  );
  return (
    <div
      aria-label={`${script.name}, running`}
      className="bg-card flex flex-none flex-col gap-2.5 rounded-[20px] border border-emerald-600/35 py-3 pr-3 pl-3.5 dark:border-[rgba(52,211,153,.3)]"
    >
      <div className="flex items-center gap-3">
        <ScriptIcon icon={script.icon} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-medium">
            {script.name}
          </span>
          <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px]">
            <StateDot state="work" size={6} />
            <span className="truncate">
              {parts.map((part, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  <span
                    className={cn(
                      part.startsWith(":") && "font-mono text-[12px]"
                    )}
                  >
                    {part}
                  </span>
                </span>
              ))}
            </span>
          </span>
        </span>
        <RoundButton
          kind="stop"
          label={`Stop ${script.name}`}
          busy={stopping}
          onClick={onStop}
        />
      </div>
      {background ? (
        <LogTail runId={run!.id} live />
      ) : (
        <div className="text-muted-foreground rounded-xl bg-[var(--block)] px-3 py-2 text-[13px]">
          Running in the session&apos;s shell drawer
        </div>
      )}
      {(onShowOutput || previewUrl) && (
        <div className="flex items-center gap-2.5">
          {onShowOutput && (
            <button
              type="button"
              onClick={onShowOutput}
              className="inline-flex h-11 items-center px-1 text-[13px] font-semibold text-violet-700 active:opacity-70 dark:text-violet-300"
            >
              Show output
            </button>
          )}
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pill pill-primary ml-auto active:opacity-80"
            >
              <ExternalLink className="h-4 w-4 flex-none" />
              Open preview
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** The sheet's content: header, running cards, script rows, the file line */
function ScriptsPanel({
  projectId,
  sessionId,
  title,
  onClose,
}: {
  projectId: string;
  sessionId: string | null;
  title: TitleSlot;
  onClose: () => void;
}) {
  const config = useProjectConfig(projectId);
  const runs = useScriptRuns(projectId);
  const project = useProjectsQuery().data?.find((p) => p.id === projectId);
  const runner = useScriptRunner(projectId, sessionId);
  const stop = useStopScriptRun(projectId);
  const now = useNow();
  const [outputId, setOutputId] = useState<string | null>(null);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMacLike()), []);

  const file = config.data?.config;
  const { running, idle } = splitScripts(file?.scripts, runs.data);
  const previewUrl = file?.previewUrl?.trim() || undefined;
  const previewId = previewScriptId(running, previewUrl);
  const output = running
    .concat(idle)
    .find((e) => e.script.id === outputId && e.run);

  const edit = () => {
    onClose();
    openProjectSettings(projectId);
  };

  const stopRun = (entry: ScriptEntry) =>
    stop.mutate(entry.run!.id, {
      onError: (e) => toast.error(stopErrorText(e, entry.script.name)),
    });

  // A terminal run shows in its session's shell drawer: an empty line opens
  // the drawer without typing anything (components/ShellDrawer)
  const showOutput = (entry: ScriptEntry) => {
    if (entry.run!.log_path) return () => setOutputId(entry.script.id);
    if (!sessionId) return null;
    return () => {
      requestTerminalRun({
        runId: `show:${entry.run!.id}:${Date.now()}`,
        sessionId,
        shellCommand: "",
      });
      onClose();
    };
  };

  if (output)
    return (
      <>
        <OutputPage
          entry={output}
          title={title}
          onBack={() => setOutputId(null)}
        />
        {runner.prompt}
      </>
    );

  const subtitle = [
    project?.name,
    running.length > 0 && `${running.length} running`,
  ]
    .filter(Boolean)
    .join(" · ");
  const empty = !config.isLoading && !file?.scripts?.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        {title("Scripts")}
        {subtitle && (
          <span className="text-muted-foreground min-w-0 truncate text-[13px]">
            {subtitle}
          </span>
        )}
      </div>

      {running.map((entry) => (
        <RunningCard
          key={entry.script.id}
          entry={entry}
          previewUrl={entry.script.id === previewId ? previewUrl! : null}
          now={now}
          stopping={stop.isPending && stop.variables === entry.run!.id}
          onStop={() => stopRun(entry)}
          onShowOutput={showOutput(entry)}
        />
      ))}

      {idle.length > 0 && (
        <div className="group-card" role="group" aria-label="Scripts">
          {idle.map(({ script, run }) => {
            const last = lastRunText(run, now);
            const spec = parseShortcut(script.shortcut);
            return (
              <ScriptRow
                key={script.id}
                leading={<ScriptIcon icon={script.icon} size={30} />}
                title={script.name}
                subtitle={
                  last ? (
                    <span
                      className={cn(
                        run?.status === "failed" &&
                          "text-red-600 dark:text-red-300"
                      )}
                    >
                      {last}
                    </span>
                  ) : (
                    <span className="font-mono text-[12px]">
                      {script.command}
                    </span>
                  )
                }
                trailing={
                  <>
                    {spec && (
                      <span className="text-muted-foreground hidden font-mono text-[12px] [@media(pointer:fine)]:inline">
                        {formatShortcut(spec, mac)}
                      </span>
                    )}
                    <RoundButton
                      kind="play"
                      label={`Run ${script.name}`}
                      busy={runner.pendingId === script.id}
                      onClick={async () => {
                        const res = await runner.run(script);
                        // The drawer behind takes it from here
                        if (res?.shellCommand) onClose();
                      }}
                    />
                  </>
                }
              />
            );
          })}
        </div>
      )}

      {config.isLoading && (
        <p className="text-muted-foreground px-1 py-6 text-center text-[14px]">
          Loading scripts…
        </p>
      )}

      {empty && (
        <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
          <p className="text-[16px] font-medium">No scripts yet</p>
          <p className="text-muted-foreground text-[14px]">
            Add Test, Lint or a dev server to run them here with one tap.
          </p>
        </div>
      )}

      <div className="text-muted-foreground -mt-1 flex items-center justify-center gap-1 text-[13px]">
        {empty ? "Kept in" : "From"}
        <span className="font-mono text-[12px]">{CONFIG_FILE}</span>·
        <button
          type="button"
          onClick={edit}
          className="inline-flex h-11 items-center px-2 font-semibold text-violet-700 active:opacity-70 dark:text-violet-300"
        >
          {empty ? "Add a script" : "Edit"}
        </button>
      </div>
      {runner.prompt}
    </div>
  );
}

/**
 * M3 (U3.2): N-Scripts. A bottom sheet over the session (beside the closed
 * Duo's column); a centred dialog on the desktop, on the open Duo's right
 * page: "Scripts · <project> · N running"; each running script's card
 * (icon, port, uptime, 3-line log tail, Stop, Show output, Open preview);
 * rows with the last run and play; "From .agent-os.json · Edit".
 */
export function ScriptsSheet({
  projectId,
  sessionId,
  open,
  onOpenChange,
}: {
  projectId: string;
  /** The session it opened over: its shell drawer runs terminal scripts */
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mode = useLayoutMode();
  const { railWidth } = useSnapshot(mobileNavStore);
  const close = () => onOpenChange(false);

  if (CENTRED.includes(mode)) {
    // The open Duo: on the right page, clear of the hinge (useHinge's middle)
    const duo = mode === "duo-open";
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "sheet-surface data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 fixed top-1/2 z-50 flex max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[28px] p-4 outline-none",
              !duo && "left-1/2 w-[calc(100vw-2rem)] max-w-[440px]"
            )}
            style={
              duo
                ? {
                    left: `calc(75vw + ${FOLD_CLEAR / 2}px - env(safe-area-inset-right) / 2)`,
                    width: `min(440px, calc(50vw - ${FOLD_CLEAR + 32}px - env(safe-area-inset-right)))`,
                  }
                : undefined
            }
          >
            <ScriptsPanel
              projectId={projectId}
              sessionId={sessionId}
              onClose={close}
              title={(text) => (
                <DialogPrimitive.Title className="min-w-0 truncate text-[20px] leading-tight font-bold">
                  {text}
                </DialogPrimitive.Title>
              )}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  // The closed Duo's web column stays beside it (E-Live, N-Scripts)
  const beside = railWidth > 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="sheet-surface bg-[var(--sheet)]"
        data-beside-column={beside ? "" : undefined}
        style={
          beside
            ? {
                right: railWidth,
                maxWidth: "none",
                maxHeight: "calc(100dvh - 64px)",
              }
            : undefined
        }
        onPointerDownOutside={(e) => {
          const target = e.target as Element | null;
          if (target?.closest?.("[data-control-column]")) e.preventDefault();
        }}
      >
        <SheetDescription className="sr-only">
          Run this project&apos;s scripts
        </SheetDescription>
        <SheetBody className="flex flex-col pt-1">
          <ScriptsPanel
            projectId={projectId}
            sessionId={sessionId}
            onClose={close}
            title={(text) => (
              <SheetTitle className="min-w-0 truncate text-[20px] leading-tight font-bold tracking-normal">
                {text}
              </SheetTitle>
            )}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** Mounted once in app/page.tsx: shows ScriptsSheet for stores/scriptsSheet */
export function ScriptsSheetHost() {
  const { projectId, sessionId } = useScriptsSheet();
  // Kept while the sheet slides away, so it closes with its content
  const [shown, setShown] = useState<{
    projectId: string;
    sessionId: string | null;
  } | null>(null);
  useEffect(() => {
    if (projectId) setShown({ projectId, sessionId });
  }, [projectId, sessionId]);
  // The closed Duo's column: × closes it, the gear edits the scripts
  useEffect(() => {
    if (!projectId) return;
    mobileNavStore.sheet = "scripts";
    const unregister = registerNavHandlers({
      closeSheet: closeScripts,
      openProjectSettings: () => {
        closeScripts();
        openProjectSettings(projectId);
      },
    });
    return () => {
      unregister();
      if (mobileNavStore.sheet === "scripts") mobileNavStore.sheet = null;
    };
  }, [projectId]);
  if (!shown) return null;
  return (
    <ScriptsSheet
      projectId={shown.projectId}
      sessionId={shown.sessionId}
      open={!!projectId}
      onOpenChange={(open) => {
        if (!open) closeScripts();
      }}
    />
  );
}
