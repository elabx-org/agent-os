"use client";

import type {
  PermissionModeState,
  SetPermissionModeRequest,
  SetPermissionModeResult,
} from "@/lib/permission-mode";

export interface UsePermissionMode {
  state: PermissionModeState | undefined;
  isLoading: boolean;
  /** Through fetchAsUser; rejects with the server's error */
  setMode: (
    request: SetPermissionModeRequest
  ) => Promise<SetPermissionModeResult>;
  setting: boolean;
  error: string | null;
}

/** A session's permission mode (GET/POST /api/sessions/[id]/permission-mode) */
export function usePermissionMode(
  _sessionId: string,
  _options: { enabled?: boolean } = {}
): UsePermissionMode {
  return {
    state: undefined,
    isLoading: false,
    setMode: () => Promise.reject(new Error("not implemented")),
    setting: false,
    error: null,
  };
}
