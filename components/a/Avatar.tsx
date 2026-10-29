"use client";

import type { CSSProperties } from "react";
import { SquareTerminal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The tile colours: one per agent, plus project colours (M1b) */
export type AvatarTone = "claude" | "codex" | "gemini" | "shell" | "other";

export interface AvatarProps {
  /** Its first letter is shown ("Claude" → C); two letters stay ("Cu") */
  label: string;
  tone?: AvatarTone;
  /** A project's own colour; overrides the tone */
  color?: string;
  /** md: 40px, radius 12; sm: 28px, radius 9 */
  size?: "md" | "sm";
  /** A glyph instead of the letter (the shell's prompt by default) */
  icon?: LucideIcon;
  className?: string;
}

// The mocks' dark tiles, and a pale wash of the same hue in light mode
const TONE_CLASS: Record<AvatarTone, string> = {
  claude: "bg-[#FBE7DF] text-[#B4532F] dark:bg-[#2A1F1A] dark:text-[#E9967A]",
  codex: "bg-[#DDF3EE] text-[#0F766E] dark:bg-[#14262A] dark:text-[#7DD3C0]",
  gemini: "bg-[#E2E9FB] text-[#2F5BB7] dark:bg-[#1A1F2E] dark:text-[#93B4F5]",
  shell: "bg-[#E5E5EA] text-[#3A3A3F] dark:bg-[#1C1C20] dark:text-[#C7C7CC]",
  other: "bg-secondary text-muted-foreground",
};

/** Each agent's name and tile letter(s); unknown ones use their own name */
const AGENTS: Record<string, { name: string; letter: string }> = {
  claude: { name: "Claude", letter: "C" },
  codex: { name: "Codex", letter: "X" },
  gemini: { name: "Gemini", letter: "G" },
  opencode: { name: "OpenCode", letter: "O" },
  aider: { name: "Aider", letter: "Ai" },
  cursor: { name: "Cursor", letter: "Cu" },
  cline: { name: "Cline", letter: "Cl" },
  minimax: { name: "MiniMax", letter: "M" },
  shell: { name: "Shell", letter: "S" },
};

/** An agent type (Session.agent_type) as its tile tone */
export function avatarTone(agentType: string | null | undefined): AvatarTone {
  switch (agentType || "claude") {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "shell":
      return "shell";
    default:
      return "other";
  }
}

/** "Claude", "Codex"…: the agent as the Now cards name it */
export function agentName(agentType: string | null | undefined): string {
  const type = agentType || "claude";
  return AGENTS[type]?.name ?? type;
}

/** An agent's tile: <Avatar {...agentAvatar(session.agent_type)} /> */
export function agentAvatar(agentType: string | null | undefined): {
  label: string;
  tone: AvatarTone;
} {
  const type = agentType || "claude";
  return { label: AGENTS[type]?.letter ?? type, tone: avatarTone(type) };
}

/** A letter tile: the agent (or project) a row is about */
export function Avatar({
  label,
  tone = "other",
  color,
  size = "md",
  icon,
  className,
}: AvatarProps) {
  const Glyph = icon ?? (tone === "shell" && !color ? SquareTerminal : null);
  const style: CSSProperties | undefined = color
    ? {
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }
    : undefined;
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "flex flex-none items-center justify-center font-bold",
        size === "md"
          ? "h-10 w-10 rounded-xl text-[15px]"
          : "h-7 w-7 rounded-[9px] text-xs",
        !color && TONE_CLASS[tone],
        className
      )}
    >
      {Glyph ? (
        <Glyph className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />
      ) : label.length <= 2 ? (
        label
      ) : (
        label.charAt(0).toUpperCase()
      )}
    </span>
  );
}
