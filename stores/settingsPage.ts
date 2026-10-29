import { proxy } from "valtio";

export type SettingsSection =
  | "notifications"
  | "display"
  | "keys"
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
  /** Labs shows after a long press on the version line, until reload */
  labs: boolean;
}>({ open: false, section: "notifications", labs: false });

export function openSettings(section?: SettingsSection) {
  if (section) settingsPageStore.section = section;
  settingsPageStore.open = true;
}

export function closeSettings() {
  settingsPageStore.open = false;
}
