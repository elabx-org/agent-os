import { proxy } from "valtio";

const KEY = "agentos:mac-inspector";

/** The Mac window's inspector (the pane on the right): shown or put away */
export const macHostStore = proxy<{ inspector: boolean }>({ inspector: true });

export function loadMacHost() {
  try {
    macHostStore.inspector = localStorage.getItem(KEY) !== "0";
  } catch {}
}

export function setMacInspector(shown: boolean) {
  macHostStore.inspector = shown;
  try {
    localStorage.setItem(KEY, shown ? "1" : "0");
  } catch {}
}
