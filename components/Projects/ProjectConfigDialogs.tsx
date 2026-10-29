"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { agentName } from "@/components/a/Avatar";
import { useViewport } from "@/hooks/useViewport";
import { CONFIG_FILE } from "@/lib/project-config-types";
import { cn } from "@/lib/utils";
import { FIELD, FieldLabel } from "./ProjectConfigParts";

/** The agents a project can default to, as the New form offers them */
export const CONFIG_AGENTS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "aider",
  "cursor",
] as const;

/** Claude's model aliases; other agents take a typed name */
export const CLAUDE_MODELS = [
  { id: "", label: "Default" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

/** "Claude · Opus", "Codex", "Not set" */
export function agentLabel(agent?: string, model?: string): string | null {
  if (!agent && !model) return null;
  const name = agentName(agent || "claude");
  const m = model
    ? (CLAUDE_MODELS.find((x) => x.id === model)?.label ?? model)
    : null;
  return m ? `${name} · ${m}` : name;
}

/** Save state shared by the small editors: busy, the error, run */
function useSaving(onOpenChange: (open: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** The shell of each editor: title, a line of help, body, Cancel / Save */
function EditorShell({
  open,
  onOpenChange,
  title,
  description,
  busy,
  error,
  onSave,
  saveDisabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  busy: boolean;
  error: string | null;
  /** No Save: choosing a row saves */
  onSave?: () => void;
  saveDisabled?: boolean;
  children: ReactNode;
}) {
  const { isTouch } = useViewport();
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className={cn(
          "flex max-h-[85vh] flex-col gap-4 overflow-y-auto sm:max-w-[460px]",
          !isTouch && "rounded-[28px] border-0 bg-[var(--sheet)] p-7"
        )}
      >
        <div className="pr-8">
          <DialogTitle className="t-head">{title}</DialogTitle>
          <DialogDescription
            className={cn(
              "text-muted-foreground mt-1 text-[13px] leading-snug",
              !description && "sr-only"
            )}
          >
            {description ?? `Saved to ${CONFIG_FILE}`}
          </DialogDescription>
        </div>
        {children}
        {error && (
          <p role="alert" className="text-[13px] text-red-500">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {busy && !onSave && (
            <Loader2 className="text-muted-foreground mr-auto h-4 w-4 animate-spin" />
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="pill pill-secondary active:opacity-70 disabled:opacity-50"
          >
            {onSave ? "Cancel" : "Done"}
          </button>
          {onSave && (
            <button
              type="button"
              disabled={busy || saveDisabled}
              onClick={onSave}
              className="pill pill-primary active:opacity-80 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A list of choices; tapping one saves it (Permission mode) */
export function ChoiceDialog<T extends string>({
  open,
  onOpenChange,
  title,
  description,
  options,
  value,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  options: { value: T; label: string; detail?: string }[];
  value: T;
  onChoose: (value: T) => Promise<void> | void;
}) {
  const { busy, error, run } = useSaving(onOpenChange);
  return (
    <EditorShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      busy={busy}
      error={error}
    >
      <div role="radiogroup" aria-label={title} className="group-card">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={busy}
            onClick={() =>
              o.value === value
                ? onOpenChange(false)
                : void run(() => onChoose(o.value))
            }
            className="row active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 w-full text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">{o.label}</span>
              {o.detail && (
                <span className="text-muted-foreground block text-[13px]">
                  {o.detail}
                </span>
              )}
            </span>
            {o.value === value && (
              <Check className="h-5 w-5 flex-none text-[hsl(var(--meter))]" />
            )}
          </button>
        ))}
      </div>
    </EditorShell>
  );
}

/** One text value, or a list of lines (`multiline`): Preview URL, setup steps */
export function TextDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial,
  placeholder,
  multiline,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  label: string;
  initial: string;
  placeholder?: string;
  multiline?: boolean;
  onSave: (value: string) => Promise<void> | void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [seeded, setSeeded] = useState(open);
  if (seeded !== open) {
    setSeeded(open);
    if (open) setValue(initial);
  }
  const { busy, error, run } = useSaving(onOpenChange);
  const save = () => void run(() => onSave(value.trim()));
  return (
    <EditorShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      busy={busy}
      error={error}
      onSave={save}
    >
      <div>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {multiline ? (
          <textarea
            id={id}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={5}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={cn(
              FIELD,
              "h-auto resize-y py-2.5 font-mono text-[13px] leading-[1.7]"
            )}
          />
        ) : (
          <input
            id={id}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={cn(FIELD, "font-mono text-[14px]")}
          />
        )}
      </div>
    </EditorShell>
  );
}

/** Default agent and model for new sessions in the project */
export function AgentDialog({
  open,
  onOpenChange,
  agent,
  model,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: string;
  model?: string;
  onSave: (agent: string, model: string) => Promise<void> | void;
}) {
  const id = useId();
  const [a, setA] = useState(agent ?? "");
  const [m, setM] = useState(model ?? "");
  const [seeded, setSeeded] = useState(open);
  if (seeded !== open) {
    setSeeded(open);
    if (open) {
      setA(agent ?? "");
      setM(model ?? "");
    }
  }
  const { busy, error, run } = useSaving(onOpenChange);
  const claude = (a || "claude") === "claude";
  return (
    <EditorShell
      open={open}
      onOpenChange={onOpenChange}
      title="Default agent"
      description="What new sessions in this project start with, on every device."
      busy={busy}
      error={error}
      onSave={() => void run(() => onSave(a, m.trim()))}
    >
      <div>
        <FieldLabel>Agent</FieldLabel>
        <div
          role="radiogroup"
          aria-label="Agent"
          className="grid grid-cols-3 gap-1.5"
        >
          {[{ v: "", label: "Not set" }]
            .concat(CONFIG_AGENTS.map((v) => ({ v, label: agentName(v) })))
            .map(({ v, label }) => (
              <button
                key={v || "none"}
                type="button"
                role="radio"
                aria-checked={a === v}
                onClick={() => {
                  setA(v);
                  if (v && v !== "claude") setM("");
                }}
                className="pick min-h-11 py-2"
              >
                {label}
              </button>
            ))}
        </div>
      </div>
      {a && (
        <div>
          <FieldLabel htmlFor={id}>Model</FieldLabel>
          {claude ? (
            <div className="seg border-foreground/10 border bg-[var(--block)]">
              {CLAUDE_MODELS.map((x) => (
                <button
                  key={x.id || "default"}
                  type="button"
                  aria-pressed={m === x.id}
                  onClick={() => setM(x.id)}
                  className="min-w-0 flex-1 px-2"
                >
                  {x.label}
                </button>
              ))}
            </div>
          ) : (
            <input
              id={id}
              value={m}
              onChange={(e) => setM(e.target.value)}
              placeholder="The agent's default"
              spellCheck={false}
              autoCapitalize="off"
              className={cn(FIELD, "font-mono text-[14px]")}
            />
          )}
        </div>
      )}
    </EditorShell>
  );
}
