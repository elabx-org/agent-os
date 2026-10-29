import { proxy, ref } from "valtio";

/** What the git page's ⋯ offers, for the closed Duo's column More */
export interface GitMenuActions {
  refresh: () => void;
  prUrl: string | null;
  prNumber: number | null;
  syncInterval: number;
  setSyncInterval: (seconds: number) => void;
}

/**
 * The shown git page's menu, while its title row leaves the ⋯ to the
 * column (E-Git): the column's More lists it. Null otherwise.
 */
export const gitMenuStore = proxy<{ actions: GitMenuActions | null }>({
  actions: null,
});

export function setGitMenu(actions: GitMenuActions | null) {
  gitMenuStore.actions = actions ? ref(actions) : null;
}
