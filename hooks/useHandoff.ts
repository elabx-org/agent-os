"use client";

import type { Session } from "@/lib/db";
import type {
  HandoffPreview,
  HandoffRequest,
  HandoffResult,
  ModelSwitchRequest,
  ModelSwitchResult,
  ResumePausedResult,
} from "@/lib/handoff-types";

/**
 * The "Agent and model" sheet's data and actions (M4, N-Switch). Actions go
 * through fetchAsUser (user-only routes) and refresh the sessions list; they
 * throw with the route's refusal text.
 */
export interface UseHandoff {
  /** GET handoff-preview while `open`; null until loaded */
  preview: HandoffPreview | null;
  loading: boolean;
  switchModel: (request: ModelSwitchRequest) => Promise<ModelSwitchResult>;
  handOff: (request: HandoffRequest) => Promise<HandoffResult>;
  /** `force` resumes although the successor still runs in the same folder */
  resumePaused: (force?: boolean) => Promise<ResumePausedResult>;
}

export function useHandoff(_session: Session, _open: boolean): UseHandoff {
  const notYet = () => Promise.reject(new Error("Not implemented")); // M4 U3
  return {
    preview: null,
    loading: false,
    switchModel: notYet,
    handOff: notYet,
    resumePaused: notYet,
  };
}
