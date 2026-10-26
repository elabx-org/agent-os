import { proxy } from "valtio";

const KEY = "agentos:focus";

/**
 * Focus mode: hides the projects list, the live activity rail, the activity
 * strip and the column's badges. Per device.
 */
export const focusStore = proxy<{ on: boolean }>({ on: false });

export function loadFocus() {
  try {
    focusStore.on = localStorage.getItem(KEY) === "1";
  } catch {}
}

export function setFocus(on: boolean) {
  focusStore.on = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}

export function toggleFocus() {
  setFocus(!focusStore.on);
}
