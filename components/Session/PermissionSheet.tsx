"use client";

import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import {
  closePermissionSheet,
  permissionSheetStore,
} from "@/stores/permissionSheet";

export interface PermissionSheetProps {
  session: Session;
  /** The column's ×, Escape, the dim or after Done */
  onClose: () => void;
}

/**
 * N-PermMode: "Permissions" and the session's title, four radio rows
 * (MODES with MODE_LABELS / MODE_HINTS, Full access's hint in red), the
 * note "Applies from the next turn. Codex and Gemini use their closest
 * matching setting." Picking a row only selects it; Done (the column's ✓,
 * mobileNavStore.sheet = "permissions" + registerNavHandlers confirmSheet,
 * or the sheet's own button where there's no column) POSTs it through
 * usePermissionMode, Full access after an in-page confirm.
 * M7 U2 builds it.
 */
export function PermissionSheet(_props: PermissionSheetProps) {
  return null;
}

/** Draws the sheet over the pane showing `session` while it's the one open */
export function PermissionSheetHost({ session }: { session: Session }) {
  const { sessionId } = useSnapshot(permissionSheetStore);
  if (sessionId !== session.id) return null;
  return <PermissionSheet session={session} onClose={closePermissionSheet} />;
}
