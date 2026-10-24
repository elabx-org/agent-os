import { proxy } from "valtio";

const KEY = "agentos:duo-preview";

/**
 * The closed-display layout on trial in the iOS app: a glance as the home and
 * a session title in the page instead of the header band. Per device.
 */
export const duoPreviewStore = proxy<{ on: boolean }>({ on: false });

export function loadDuoPreview() {
  try {
    duoPreviewStore.on = localStorage.getItem(KEY) === "1";
  } catch {}
}

export function setDuoPreview(on: boolean) {
  duoPreviewStore.on = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}
