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
  /** A picked mode that isn't in force yet */
  pending: boolean;
  /**
   * When it will be: the turn's end (the dot; the chip looks again until
   * it's in) or only a restart; null when nothing waits
   */
  waitsFor: "nextTurn" | "restart" | null;
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
  // An older server leaves out the reason: the turn's end, as it was
  const waitsFor = pending
    ? state.pendingAppliesAt === "restart"
      ? "restart"
      : "nextTurn"
    : null;
  const when =
    waitsFor === "restart"
      ? "after a restart"
      : waitsFor === "nextTurn"
        ? "from the next turn"
        : null;
  return {
    mode,
    label,
    pending,
    waitsFor,
    tone: mode === "bypassPermissions" ? "danger" : "set",
    ariaLabel: when
      ? `Permissions: ${label}, ${when}`
      : `Permissions: ${label}`,
    title: when ? when[0].toUpperCase() + when.slice(1) : undefined,
  };
}
