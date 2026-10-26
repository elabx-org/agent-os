import { proxy } from "valtio";

export type SettingsSection =
  | "notifications"
  | "display"
  | "duo"
  | "usage"
  | "claude"
  | "sessions"
  | "server";

/** Settings as its own layer over the app: the gear, ⌘, or the iOS app's nav */
export const settingsPageStore = proxy<{
  open: boolean;
  section: SettingsSection;
}>({ open: false, section: "notifications" });

export function openSettings(section?: SettingsSection) {
  if (section) settingsPageStore.section = section;
  settingsPageStore.open = true;
}

export function closeSettings() {
  settingsPageStore.open = false;
}
