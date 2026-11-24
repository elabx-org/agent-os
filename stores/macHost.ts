import { proxy } from "valtio";

const KEY = "agentos:mac-inspector";
const SPLIT_KEY = "agentos:mac-diff-split";

/**
 * The Mac window's own choices: the inspector (the pane on the right) shown
 * or put away, the same while reviewing changes (away unless asked for: the
 * review takes the room), and diffs side by side. The desktop web shell
 * shares the last one and the Preview.
 */
export const macHostStore = proxy<{
  inspector: boolean;
  reviewInspector: boolean;
  split: boolean;
  /** A page's own line for under the window's title ("5 on 2 machines") */
  pageDetail: string | null;
  /**
   * Preview (the Mac toolbar's tab, the desktop header's): the page a
   * session's server serves, over its views
   */
  preview: boolean;
}>({
  inspector: true,
  reviewInspector: false,
  split: false,
  pageDetail: null,
  preview: false,
});

export function setMacPreview(shown: boolean) {
  macHostStore.preview = shown;
}

export function setMacPageDetail(detail: string | null) {
  macHostStore.pageDetail = detail;
}

export function loadMacHost() {
  try {
    macHostStore.inspector = localStorage.getItem(KEY) !== "0";
    macHostStore.split = localStorage.getItem(SPLIT_KEY) === "1";
  } catch {}
}

/** `reviewing`: the Changes view is in front, which has its own choice */
export function setMacInspector(shown: boolean, reviewing = false) {
  if (reviewing) {
    macHostStore.reviewInspector = shown;
    return;
  }
  macHostStore.inspector = shown;
  try {
    localStorage.setItem(KEY, shown ? "1" : "0");
  } catch {}
}

export function setMacSplit(split: boolean) {
  macHostStore.split = split;
  try {
    localStorage.setItem(SPLIT_KEY, split ? "1" : "0");
  } catch {}
}
