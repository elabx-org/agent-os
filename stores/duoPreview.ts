import { proxy } from "valtio";

const KEY = "agentos:duo-preview";

/**
 * The session's title in the page (the closed Duo's crumb and 22px title,
 * half folded's title pill, the open Duo's large title) instead of the
 * classic header band. On unless turned off in Settings → iPhone Duo. Per
 * device.
 */
export const duoPreviewStore = proxy<{ on: boolean }>({ on: true });

export function loadDuoPreview() {
  try {
    duoPreviewStore.on = localStorage.getItem(KEY) !== "0";
  } catch {}
}

export function setDuoPreview(on: boolean) {
  duoPreviewStore.on = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}
