import type { AgentType } from "@/lib/providers";
import {
  MODES,
  MODE_LABELS,
  flagsFor,
  type Mode,
  type PermissionModeState,
} from "@/lib/permission-mode";

/** Whether any mode launches the agent differently (shell, Cursor: none) */
export function hasPermissionModes(agentType: AgentType): boolean {
  return MODES.some((mode) => flagsFor(agentType, mode).length > 0);
}

/** What the shield chip shows */
export interface ChipModel {
  /** The mode named on the chip: the one waiting, else the one in force */
  mode: Mode;
  label: string;
  /** Picked mid-turn, applies from the next one (the dot) */
  pending: boolean;
  tone: "set" | "danger";
  ariaLabel: string;
  title: string | undefined;
}

/**
 * The chip for a session's permission state; null while it loads and for
 * agents with no modes. What Claude reports running wins over the stored
 * mode (Shift+Tab in its terminal changes it without us).
 */
export function chipModel(
  state: PermissionModeState | null | undefined,
  agentType: AgentType
): ChipModel | null {
  if (!state || !hasPermissionModes(agentType)) return null;
  const current = state.live ?? state.mode;
  const pending = !!state.pending && state.pending !== current;
  const mode = pending ? state.pending! : current;
  const label = MODE_LABELS[mode];
  return {
    mode,
    label,
    pending,
    tone: mode === "bypassPermissions" ? "danger" : "set",
    ariaLabel: pending
      ? `Permissions: ${label}, from the next turn`
      : `Permissions: ${label}`,
    title: pending ? "From the next turn" : undefined,
  };
}
