"use client";

import { useCallback, useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import type { Session } from "@/lib/db";
import {
  HANDOFF_AGENTS,
  isPaused,
  type ClaudeModelAlias,
  type EffortLevel,
  type HandoffAgent,
  type ModelSwitchResult,
} from "@/lib/handoff-types";
import { isSettled } from "@/lib/settle-types";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { registerNavHandlers } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";
import { useClaudeState } from "@/hooks/useClaudeState";
import { useHandoff } from "@/hooks/useHandoff";
import { useCliStatus } from "@/data/cli-status";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  currentEffort,
  currentModel,
  effortLabel,
  effortOptions,
  modelPicks,
  modelRowCaption,
  switchAction,
} from "./switch-model";

/**
 * N-Switch "Agent and model": Claude model + effort (between turns, queued
 * as `/model`), and the agent pick, which is a handoff to a new session in
 * the same folder with a summary; this one stays listed, paused.
 */
export interface SwitchSheetProps {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a handoff: open the new session */
  onHandedOff?: (newSession: Session) => void;
}

/** The column's sheet id while this is up (close only, as in the mock) */
const SHEET_ID = "switch";

export function SwitchSheet({
  session,
  open,
  onOpenChange,
  onHandedOff,
}: SwitchSheetProps) {
  // The closed Duo's web column stays beside it, its × in reach
  const { railWidth } = useSnapshot(mobileNavStore);
  const beside = railWidth > 0;

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  // The column's × (web and the iOS app's) closes it while it's open
  useEffect(() => {
    if (!open) return;
    // N-Switch: the column shows its close alone
    mobileNavStore.sheet = SHEET_ID;
    const unregister = registerNavHandlers({ closeSheet: close });
    return () => {
      unregister();
      if (mobileNavStore.sheet === SHEET_ID) mobileNavStore.sheet = null;
    };
  }, [open, close]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "sheet-surface bg-[var(--sheet)] pb-[max(16px,env(safe-area-inset-bottom))]",
          // Half folded (tabletop): on the base, below the hinge, full width
          // so the handoff's details fit above the button
          "[html[data-fold=horizontal]_&]:top-[calc(var(--fold-end)+0.5rem)] [html[data-fold=horizontal]_&]:mx-0 [html[data-fold=horizontal]_&]:max-h-none [html[data-fold=horizontal]_&]:w-auto [html[data-fold=horizontal]_&]:max-w-none",
          // Book pose without the app (globals.css sets left): the right page
          "[html[data-fold=vertical]_&]:right-0 [html[data-fold=vertical]_&]:mx-0 [html[data-fold=vertical]_&]:w-auto [html[data-fold=vertical]_&]:max-w-none",
          // The open Duo lying flat: on the right page, clear of the hinge
          "[html[data-hinge]_&]:right-0 [html[data-hinge]_&]:left-[calc(var(--hinge-x)+var(--fold-clear))] [html[data-hinge]_&]:mx-0 [html[data-hinge]_&]:w-auto [html[data-hinge]_&]:max-w-none"
        )}
        data-beside-column={beside ? "" : undefined}
        // left 0 + right at the column: w-full would win over right
        style={
          beside
            ? { right: railWidth, width: "auto", maxWidth: "none" }
            : undefined
        }
        onPointerDownOutside={(e) => {
          const target = e.target as Element | null;
          if (target?.closest?.("[data-control-column]")) e.preventDefault();
        }}
      >
        <SheetDescription className="sr-only">
          Switch Claude&apos;s model between turns, or hand this session off to
          another agent
        </SheetDescription>
        {open ? (
          <SwitchBody
            session={session}
            onClose={close}
            onHandedOff={onHandedOff}
          />
        ) : (
          <SheetTitle className="sr-only">Agent and model</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CarryRow({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex min-h-[22px] items-center gap-2 text-[13px]",
        ok ? "text-foreground/90" : "text-muted-foreground"
      )}
    >
      {ok ? (
        <Check
          aria-hidden
          className="dark:text-work h-3.5 w-3.5 shrink-0 text-emerald-600"
          strokeWidth={2.6}
        />
      ) : (
        <X aria-hidden className="h-3.5 w-3.5 shrink-0" />
      )}
      {children}
    </span>
  );
}

/** Mounted while open, so the picks start from the session each time */
function SwitchBody({
  session,
  onClose,
  onHandedOff,
}: {
  session: Session;
  onClose: () => void;
  onHandedOff?: (newSession: Session) => void;
}) {
  const source = session.agent_type || "claude";
  const sourceName = agentName(source);
  const claude = source === "claude";
  const { status } = useClaudeState(session.id, claude);
  const { preview, switchModel, handOff } = useHandoff(session, true);
  const { data: cli } = useCliStatus();

  const current = claude
    ? currentModel(status?.model, session.model)
    : { alias: null, label: null };
  const runningEffort = claude
    ? currentEffort(status?.effort?.level, session.effort)
    : null;

  const [agent, setAgent] = useState<string>(source);
  const [model, setModel] = useState<ClaudeModelAlias | null>(current.alias);
  const [effort, setEffort] = useState<EffortLevel | null>(runningEffort);
  const [sending, setSending] = useState(false);

  // The status line can land after the sheet opened: follow it until a pick
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setModel(current.alias);
    setEffort(runningEffort);
  }, [touched, current.alias, runningEffort]);

  const picks = modelPicks(current);
  const pickedName = agentName(agent);
  const modelOn = agent === "claude";
  // Effort is this Claude's own: a handoff starts with its default
  const effortOn = claude && agent === "claude";
  const modelChanged = !!model && model !== current.alias;
  const effortChanged = !!effort && effort !== runningEffort;
  const modelLabel = picks.find((p) => p.alias === model)?.label ?? null;
  const action = switchAction({
    source,
    sourceName,
    picked: agent,
    pickedName,
    modelLabel,
    modelChanged,
    effortChanged,
    busy: !!preview?.busy,
    paused: isPaused(session),
    settled: isSettled(session),
  });
  const caption = modelRowCaption({ source, picked: agent, pickedName });
  const disabled = sending || action.disabled;

  const confirmSwitch = (r: ModelSwitchResult) => {
    const what = modelChanged
      ? (modelLabel ?? r.model)
      : `${effortLabel(effort!)} effort`;
    if (!r.queued) toast(`${what} from the session's next start`);
    else toast(`Switching to ${what} between turns`);
  };

  const run = async () => {
    if (disabled) return;
    setSending(true);
    try {
      if (action.kind === "handoff") {
        const result = await handOff({
          agentType: agent as HandoffAgent,
          model: agent === "claude" ? (model ?? undefined) : undefined,
        });
        haptic("success");
        toast(`Handed off to ${pickedName}`);
        onClose();
        onHandedOff?.(result.session);
      } else if (action.kind === "model") {
        // Only what changed: an unchanged model sends no `/model`, which
        // would drop a variant like Opus (1M context) to the plain alias
        const result = await switchModel({
          ...(modelChanged && model ? { model } : {}),
          ...(effortChanged && effort ? { effort } : {}),
        });
        haptic("success");
        confirmSwitch(result);
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const efforts = effortOptions(runningEffort, effort);
  const files = preview?.filesChanged ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 [html[data-fold=horizontal]_&]:gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <SheetTitle className="t-title text-[20px] leading-tight font-bold tracking-normal">
          Agent and model
        </SheetTitle>
        <span className="text-muted-foreground shrink-0 text-[13px]">
          Between turns
        </span>
      </div>

      {/* Model (Claude only) */}
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center justify-between text-[13px]">
          <span className="text-foreground/90 font-semibold">Model</span>
          <span>Claude only</span>
        </div>
        <div
          role="radiogroup"
          aria-label="Claude model"
          aria-disabled={!modelOn || undefined}
          className={cn(
            "grid grid-cols-3 gap-2 transition-opacity",
            !modelOn && "opacity-40"
          )}
        >
          {picks.map((p) => (
            <button
              key={p.alias}
              type="button"
              role="radio"
              aria-checked={model === p.alias}
              disabled={!modelOn || sending}
              onClick={() => {
                setTouched(true);
                setModel(p.alias);
              }}
              className={cn(
                "pick min-w-0 gap-0.5 px-1 py-[9px]",
                model === p.alias && "on"
              )}
            >
              <span className="max-w-full truncate font-semibold">
                {p.label}
              </span>
              <span className="text-muted-foreground max-w-full truncate text-[11px] [html[data-fold=horizontal]_&]:hidden">
                {p.caption}
              </span>
            </button>
          ))}
        </div>
        <div
          className={cn(
            "flex items-center gap-2.5 transition-opacity",
            !effortOn && "opacity-40"
          )}
          aria-disabled={!effortOn || undefined}
        >
          <span className="text-muted-foreground w-11 shrink-0 text-[13px]">
            Effort
          </span>
          <div
            role="group"
            aria-label="Effort"
            className="seg min-w-0 flex-1 justify-between rounded-3xl bg-[var(--sheet-fill)]"
          >
            {efforts.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={effort === level}
                disabled={!effortOn || sending}
                onClick={() => {
                  setTouched(true);
                  setEffort(level);
                }}
                className="h-11 min-w-0 flex-1 truncate rounded-[22px] px-1"
              >
                {effortLabel(level)}
              </button>
            ))}
          </div>
        </div>
        {caption && (
          <p
            className={cn(
              "text-muted-foreground text-[13px]",
              // Half folded the dimmed row says enough without it
              !modelOn && "[html[data-fold=horizontal]_&]:hidden"
            )}
          >
            {caption}
          </p>
        )}
      </div>

      <div className="h-px shrink-0 bg-[var(--hair)]" />

      {/* Agent: another one is a handoff */}
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center justify-between text-[13px]">
          <span className="text-foreground/90 font-semibold">Agent</span>
          <span>Switching is a handoff</span>
        </div>
        <div
          role="radiogroup"
          aria-label="Agent"
          className="grid grid-cols-3 gap-2"
        >
          {HANDOFF_AGENTS.map((type) => {
            const missing = type !== source && cli?.[type]?.installed === false;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={agent === type}
                aria-label={
                  missing
                    ? `${agentName(type)}, not installed`
                    : agentName(type)
                }
                disabled={missing || sending}
                onClick={() => {
                  setTouched(true);
                  setAgent(type);
                }}
                className={cn(
                  "pick min-h-12 min-w-0 flex-row gap-2 px-1 py-2 disabled:opacity-40",
                  agent === type && "on"
                )}
              >
                <Avatar {...agentAvatar(type)} size="sm" />
                <span className="min-w-0 truncate">{agentName(type)}</span>
              </button>
            );
          })}
        </div>

        {agent !== source && (
          <div className="flex flex-col gap-2.5 rounded-2xl bg-[var(--sheet-fill)] px-3.5 py-3">
            {/* Half folded the button and "Switching is a handoff" say
                it, and the details must fit above the button */}
            <p className="text-foreground/90 text-sm [html[data-fold=horizontal]_&]:hidden">
              {pickedName} starts a new session in the same folder with a
              summary of this one.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-[13px] font-semibold">
                  Carries over
                </span>
                <CarryRow ok>Summary</CarryRow>
                {files > 0 && (
                  <CarryRow ok>
                    {files} {files === 1 ? "file" : "files"} changed
                  </CarryRow>
                )}
                {preview?.plan && preview.plan.total > 0 && (
                  <CarryRow ok>
                    Open plan, {preview.plan.done} of {preview.plan.total}
                  </CarryRow>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-[13px] font-semibold">
                  Stays here
                </span>
                <CarryRow ok={false}>Full transcript</CarryRow>
                <span className="text-muted-foreground mt-0.5 text-[13px]">
                  {sourceName}&apos;s session stays in the list, paused.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-[var(--sheet)] pt-1">
        {action.note && (
          <p
            role="status"
            className="text-muted-foreground text-center text-[13px]"
          >
            {action.note}
          </p>
        )}
        <button
          type="button"
          onClick={run}
          disabled={disabled}
          className="pill pill-primary h-[50px] w-full rounded-[25px] text-base active:opacity-80 disabled:opacity-50"
        >
          {sending ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            action.kind === "handoff" && (
              <Avatar
                {...agentAvatar(agent)}
                size="sm"
                className="h-[22px] w-[22px] rounded-md text-[11px]"
              />
            )
          )}
          <span className="truncate">{action.label}</span>
        </button>
      </div>
    </div>
  );
}
