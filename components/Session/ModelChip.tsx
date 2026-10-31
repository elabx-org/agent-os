"use client";

import { ChevronDown } from "lucide-react";
import type { Session } from "@/lib/db";
import { isHandoffAgent } from "@/lib/handoff-types";
import { cn } from "@/lib/utils";
import { useClaudeState } from "@/hooks/useClaudeState";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { currentModel } from "./switch-model";

/** The sessions the sheet can switch: Claude, Codex, Gemini */
export function canSwitch(session: Session | null | undefined): boolean {
  return !!session && isHandoffAgent(session.agent_type || "claude");
}

/**
 * "Claude · Opus 5.5": the agent and, for Claude, the model it runs (its
 * status line's name, else sessions.model); other agents by their stored
 * model when they have one
 */
export function useModelLabel(session: Session): string {
  const type = session.agent_type || "claude";
  const claude = type === "claude";
  const { status, transcriptModel } = useClaudeState(session.id, claude);
  const model = claude
    ? currentModel(status?.model ?? transcriptModel, session.model).label
    : session.model || null;
  return [agentName(type), model].filter(Boolean).join(" · ");
}

export interface ModelChipProps {
  session: Session;
  open: boolean;
  onOpen: () => void;
  className?: string;
}

/**
 * The header chip "[C] Claude · Opus 5.5 ⌄" (N-Switch) that opens the
 * SwitchSheet; the model from readClaudeState().status.model when live,
 * else sessions.model
 */
export function ModelChip({
  session,
  open,
  onOpen,
  className,
}: ModelChipProps) {
  const label = useModelLabel(session);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Agent and model: ${label.replace(" · ", ", ")}`}
      className={cn(
        "chip hover:text-foreground relative min-w-[64px] shrink pr-2.5 pl-1.5 transition-shadow",
        // A 44pt touch around the 30px chip
        "after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
        open && "text-foreground shadow-[0_0_0_1.5px_hsl(var(--meter))]",
        className
      )}
    >
      <Avatar
        {...agentAvatar(session.agent_type)}
        size="sm"
        className="h-[18px] w-[18px] rounded-[5px] text-[10px]"
      />
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 opacity-70"
        strokeWidth={2.2}
      />
    </button>
  );
}
