import { proxy } from "valtio";

/**
 * N-PermMode: the session whose Permissions sheet is up. The header and
 * composer chips open it; the pane that shows that session draws it
 * (components/Session/PermissionSheet.tsx PermissionSheetHost).
 */
export const permissionSheetStore = proxy<{ sessionId: string | null }>({
  sessionId: null,
});

export function openPermissionSheet(sessionId: string): void {
  permissionSheetStore.sessionId = sessionId;
}

export function closePermissionSheet(): void {
  permissionSheetStore.sessionId = null;
}
