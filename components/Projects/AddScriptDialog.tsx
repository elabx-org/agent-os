"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { GitBranch, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useViewport } from "@/hooks/useViewport";
import { isMacLike } from "@/hooks/useViewShortcuts";
import {
  CONFIG_FILE,
  SCRIPT_ICONS,
  type ProjectScript,
  type ScriptRunIn,
} from "@/lib/project-config-types";
import {
  isReservedShortcut,
  shortcutFromEvent,
  shortcutText,
} from "@/lib/script-shortcuts";
import { cn } from "@/lib/utils";
import { FIELD, FieldLabel, shortcutLabel } from "./ProjectConfigParts";
import {
  cleanScript,
  sameShortcutText,
  scriptId,
  setupSummary,
} from "./ProjectConfigText";
import { ScriptIcon } from "./ScriptIcon";

const MOD_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "OS"]);

/**
 * M3 (U3.3): D-Config's Add script dialog (a sheet on touch): name,
 * command, icon grid, Run in (Session terminal | Background), keyboard
 * shortcut recorder, "Run when a worktree is created"; "Saves to
 * .agent-os.json". Also edits an existing script (`initial`).
 */
export function AddScriptDialog({
  open,
  onOpenChange,
  initial,
  scripts,
  onDraftChange,
  onSave,
  onDelete,
  setup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ProjectScript;
  /** The other scripts, for id and shortcut clashes */
  scripts: ProjectScript[];
  /** Changes as typed, for ConfigPreview's highlighted lines */
  onDraftChange?: (draft: ProjectScript | null) => void;
  onSave: (script: ProjectScript) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  /** The worktree setup steps, for the toggle's "After …" line */
  setup?: readonly string[];
}) {
  const { isTouch } = useViewport();
  const ids = useId();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<string>("terminal");
  const [runIn, setRunIn] = useState<ScriptRunIn>("terminal");
  const [shortcut, setShortcut] = useState("");
  const [onWorktree, setOnWorktree] = useState(false);
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A fresh form each time it opens, from the script being edited
  const [seeded, setSeeded] = useState<{
    open: boolean;
    initial?: ProjectScript;
  }>({ open: false });
  if (seeded.open !== open || seeded.initial !== initial) {
    setSeeded({ open, initial });
    if (open) {
      setName(initial?.name ?? "");
      setCommand(initial?.command ?? "");
      setIcon(initial?.icon ?? "terminal");
      setRunIn(initial?.in === "background" ? "background" : "terminal");
      setShortcut(initial?.shortcut ?? "");
      setOnWorktree(!!initial?.onWorktree);
      setKeyNote(null);
      setError(null);
      setBusy(null);
    }
  }

  const others = useMemo(
    () => scripts.filter((s) => s.id !== initial?.id),
    [scripts, initial?.id]
  );
  const draft = useMemo<ProjectScript>(
    () =>
      cleanScript({
        ...initial,
        id:
          initial?.id ??
          scriptId(
            name || command,
            others.map((s) => s.id)
          ),
        name: name || "",
        command,
        icon,
        in: runIn,
        shortcut: shortcut || undefined,
        onWorktree,
      }),
    [initial, name, command, icon, runIn, shortcut, onWorktree, others]
  );

  const report = useRef(onDraftChange);
  report.current = onDraftChange;
  // By value: a parent re-render mustn't report the same draft again
  const shown = open && !!(name.trim() || command.trim());
  const draftKey = shown ? JSON.stringify(draft) : "";
  useEffect(() => {
    report.current?.(draftKey ? (JSON.parse(draftKey) as ProjectScript) : null);
  }, [draftKey]);
  useEffect(() => () => report.current?.(null), []);

  const valid = !!name.trim() && !!command.trim();

  const recordKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Tab" || e.key === "Escape") return;
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      e.preventDefault();
      setShortcut("");
      setKeyNote(null);
      return;
    }
    if (MOD_KEYS.has(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const mac = isMacLike();
    const spec = shortcutFromEvent(e.nativeEvent, mac);
    if (!spec) {
      setKeyNote(
        `Use ${mac ? "⌘" : "Ctrl"} with a letter or digit, and Shift or ${mac ? "⌥" : "Alt"} if you like`
      );
      return;
    }
    if (isReservedShortcut(spec)) {
      setKeyNote("That one is taken by Agent-OS, the browser or the terminal");
      return;
    }
    const text = shortcutText(spec);
    if (!text) return;
    const clash = others.find(
      (s) => s.shortcut && sameShortcutText(s.shortcut, text)
    );
    if (clash) {
      setKeyNote(`${clash.name} uses that one`);
      return;
    }
    setShortcut(text);
    setKeyNote(null);
  };

  const run = async (kind: "save" | "delete") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") await onSave(draft);
      else await onDelete?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  };

  const editing = !!initial;
  const title = editing ? "Edit script" : "Add script";

  // D-Config: beside the file preview the dialog keeps to the page on its
  // left, so the lines it adds stay in view
  const [besideAt, setBesideAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open || isTouch) return setBesideAt(null);
    const aside = document.querySelector("[data-config-preview]");
    const left = aside?.getBoundingClientRect().left ?? 0;
    setBesideAt(aside && left > 600 ? left : null);
  }, [open, isTouch]);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className={cn(
          "on-sheet flex max-h-[90vh] flex-col gap-5 overflow-y-auto sm:max-w-[520px] lg:max-w-[748px]",
          !isTouch && "rounded-[28px] border-0 bg-[var(--sheet)] p-8",
          besideAt !== null && "gap-4 px-6 py-[22px] lg:max-w-[540px]"
        )}
        style={
          besideAt !== null
            ? { left: besideAt / 2, width: Math.min(540, besideAt - 48) }
            : undefined
        }
      >
        <DialogTitle className="t-title pr-10">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          A command you can run from the project, saved to {CONFIG_FILE}.
        </DialogDescription>

        <form
          id={`${ids}-form`}
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) void run("save");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
            <div className="min-w-0">
              <FieldLabel htmlFor={`${ids}-name`}>Name</FieldLabel>
              <input
                id={`${ids}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Test"
                autoFocus={!isTouch}
                autoComplete="off"
                className={FIELD}
              />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor={`${ids}-cmd`}>Command</FieldLabel>
              <input
                id={`${ids}-cmd`}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npm test"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={cn(FIELD, "font-mono text-[14px]")}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Icon</FieldLabel>
            <div
              role="radiogroup"
              aria-label="Icon"
              className="grid grid-cols-8 gap-1.5"
            >
              {SCRIPT_ICONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={icon === name}
                  aria-label={name}
                  title={name}
                  onClick={() => setIcon(name)}
                  className={cn(
                    "text-foreground/80 flex h-11 min-w-0 items-center justify-center rounded-xl border-[1.5px] border-transparent bg-[hsl(var(--card))]",
                    icon === name &&
                      "text-foreground border-[hsl(var(--meter))] bg-[hsl(var(--primary)/0.16)]"
                  )}
                >
                  <ScriptIcon icon={name} size={22} plain />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="min-w-0">
              <FieldLabel>Run in</FieldLabel>
              <div
                className="seg border-foreground/10 border bg-[var(--block)]"
                role="group"
                aria-label="Run in"
              >
                {(
                  [
                    ["terminal", "Session terminal"],
                    ["background", "Background"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={runIn === value}
                    onClick={() => setRunIn(value)}
                    className="flex-auto px-3 text-[14px] whitespace-nowrap"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor={`${ids}-key`}>Keyboard shortcut</FieldLabel>
              <div className="relative">
                <button
                  id={`${ids}-key`}
                  type="button"
                  onKeyDown={recordKey}
                  aria-describedby={`${ids}-keynote`}
                  className={cn(
                    FIELD,
                    "flex items-center gap-2 pr-10 text-left focus-visible:ring-[3px]"
                  )}
                >
                  <span className="font-mono text-[14px]">
                    {shortcut ? shortcutLabel(shortcut) : "None"}
                  </span>
                  {/* With a shortcut set, its clear button takes the hint's room */}
                  {!shortcut && (
                    <span className="text-muted-foreground ml-auto truncate text-[13px]">
                      Press keys to set
                    </span>
                  )}
                </button>
                {shortcut && (
                  <button
                    type="button"
                    aria-label="Remove shortcut"
                    onClick={() => {
                      setShortcut("");
                      setKeyNote(null);
                    }}
                    className="text-muted-foreground absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p
                id={`${ids}-keynote`}
                aria-live="polite"
                className={cn(
                  "mt-1 min-h-[1em] text-[12px]",
                  keyNote ? "text-[hsl(var(--needs))]" : "sr-only"
                )}
              >
                {keyNote ?? "Focus it and press the keys"}
              </p>
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-2xl bg-[hsl(var(--card))] px-4 py-3">
            <GitBranch
              aria-hidden
              className="text-muted-foreground h-5 w-5 flex-none"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">
                Run when a worktree is created
              </span>
              <span className="text-muted-foreground block truncate text-[14px]">
                {setupSummary(setup)}
              </span>
            </span>
            <Switch
              checked={onWorktree}
              onCheckedChange={setOnWorktree}
              aria-label="Run when a worktree is created"
              className="data-[state=checked]:bg-[hsl(var(--work))]"
            />
          </label>
        </form>

        {error && (
          <p role="alert" className="text-[13px] text-red-500">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground mr-auto text-[13px]">
            Saves to <span className="font-mono">{CONFIG_FILE}</span>
          </span>
          {editing && onDelete && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run("delete")}
              className="pill pill-sm text-red-500 active:opacity-70 disabled:opacity-50"
            >
              {busy === "delete" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Delete
            </button>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => onOpenChange(false)}
            className="pill pill-secondary active:opacity-70 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={`${ids}-form`}
            disabled={!valid || !!busy}
            className="pill pill-primary active:opacity-80 disabled:opacity-50"
          >
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save" : "Add script"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
