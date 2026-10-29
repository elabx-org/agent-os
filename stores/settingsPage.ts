import { proxy } from "valtio";

export type SettingsSection =
  | "notifications"
  | "display"
  | "keys"
  | "column"
  | "duo"
  | "usage"
  | "claude"
  | "sessions"
  | "uploads"
  | "server"
  | "labs";

/** Settings as its own layer over the app: the gear, ⌘, or the iOS app's nav */
export const settingsPageStore = proxy<{
  open: boolean;
  section: SettingsSection;
  /**
   * Drilled into `section`: on the closed Duo and phones the list and each
   * section are pages of their own, and back returns to the list. The
   * list|detail split (open Duo, desktop) ignores it.
   */
  detail: boolean;
  /** Labs shows after a long press on the version line, until reload */
  labs: boolean;
}>({ open: false, section: "notifications", detail: false, labs: false });

/** Opens on the list, or straight on a section when one is named */
export function openSettings(section?: SettingsSection) {
  if (section) settingsPageStore.section = section;
  settingsPageStore.detail = !!section;
  settingsPageStore.open = true;
}

/** A section as its own page (beside the list when split) */
export function showSettingsSection(section: SettingsSection) {
  settingsPageStore.section = section;
  settingsPageStore.detail = true;
}

/** From a section back to the list; false when there's nowhere to go back */
export function settingsBack(): boolean {
  if (!settingsPageStore.open || !settingsPageStore.detail) return false;
  settingsPageStore.detail = false;
  return true;
}

export function closeSettings() {
  settingsPageStore.open = false;
  settingsPageStore.detail = false;
}
