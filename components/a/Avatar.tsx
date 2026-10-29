"use client";

import { cn } from "@/lib/utils";

/** The tile colours: one per agent, plus project colours (M1b) */
export type AvatarTone = "claude" | "codex" | "gemini" | "shell" | "other";

export interface AvatarProps {
  /** Its first letter is shown ("Claude" → C) */
  label: string;
  tone?: AvatarTone;
  /** A project's own colour; overrides the tone */
  color?: string;
  /** md: 40px, radius 12; sm: 28px, radius 9 */
  size?: "md" | "sm";
  className?: string;
}

/** An agent type (Session.agent_type) as its tile tone */
export function avatarTone(agentType: string | null | undefined): AvatarTone {
  // Contract stub: U1.3
  void agentType;
  return "other";
}

/** A letter tile: the agent (or project) a row is about */
export function Avatar({ label, size = "md", className }: AvatarProps) {
  // Contract stub: U1.3 adds the tones and colours
  return (
    <span
      aria-hidden
      className={cn(
        "bg-secondary flex flex-none items-center justify-center font-bold",
        size === "md"
          ? "h-10 w-10 rounded-xl text-[15px]"
          : "h-7 w-7 rounded-[9px] text-xs",
        className
      )}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
