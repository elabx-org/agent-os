/**
 * The words and choices of a session's Permissions sheet (N-PermMode),
 * kept apart from the component so they can be tested
 */

import type { AgentType } from "@/lib/providers";
import {
  MODE_LABELS,
  type Mode,
  type PermissionModeState,
  type SetPermissionModeResult,
} from "@/lib/permission-mode";

/**
 * The row the sheet starts on, as the chip shows it: a change still waiting
 * for the turn, else what Claude reports running (Shift+Tab in its
 * terminal changes it without us), else the stored mode
 */
export function initialChoice(
  state: PermissionModeState | undefined
): Mode | null {
  if (!state) return null;
  return state.pending ?? state.live ?? state.mode;
}

/** The pending change is a different mode from the one running now */
export function isWaiting(state: PermissionModeState | undefined): boolean {
  return !!state?.pending && state.pending !== (state.live ?? state.mode);
}

/** Done with the row it opened on changes nothing, so it only closes */
export function needsPost(
  choice: Mode | null,
  state: PermissionModeState | undefined
): choice is Mode {
  return !!choice && !!state && choice !== initialChoice(state);
}

/** Only Claude's sessions restart from here (POST /api/sessions/[id]/restart) */
export function canRestartHere(agentType: AgentType): boolean {
  return agentType === "claude";
}

const AGENT_NAMES: Partial<Record<AgentType, string>> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  minimax: "Minimax",
};

/** The agent as the toast names it */
export function agentName(agentType: AgentType): string {
  return AGENT_NAMES[agentType] ?? "The agent";
}

export interface ModeToast {
  text: string;
  /** Offer "Restart now" (Claude, when the change waits for a restart) */
  restart: boolean;
}

/** What the sheet says once the server took the change */
export function modeToast(
  result: Pick<SetPermissionModeResult, "mode" | "appliesAt">,
  agentType: AgentType
): ModeToast {
  const label = MODE_LABELS[result.mode];
  switch (result.appliesAt) {
    case "now":
      return { text: `${label} on`, restart: false };
    case "nextTurn":
      return { text: `${label} from the next turn`, restart: false };
    case "restart":
      return canRestartHere(agentType)
        ? { text: `${label} after a restart`, restart: true }
        : {
            text: `${agentName(agentType)} takes this when it restarts`,
            restart: false,
          };
    case "nextLaunch":
      return { text: "Applies when it starts", restart: false };
  }
}

/** The in-page confirm before full access */
export function fullAccessConfirm(title: string) {
  return {
    title: `Switch ${title} to full access?`,
    message: "It will never ask, even to delete files.",
    confirmLabel: "Switch to full access",
    destructive: true,
  };
}

/** The restart route's 409 {busy: true}: it won't cut a turn short */
export const RESTART_BUSY = "Claude is busy. Restart it when this turn ends";
