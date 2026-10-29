/**
 * The agents view (M13) and the iOS app: `agents` replaces `workers`, which
 * stays as an alias, and iOS app 0.1.62 decodes viewMode into a fixed enum
 * and drops unknown values, so `agents` is posted to it as `workers`
 */

import type { PaneViewMode } from "@/stores/mobileNav";

/** The view modes iOS app 0.1.62 knows (AppModel.swift PaneView) */
export type NativeViewMode = "terminal" | "chat" | "files" | "git" | "workers";

/** The view a pane shows for a requested mode: `workers` is the agents view */
export function canonicalViewMode(mode: PaneViewMode): PaneViewMode {
  return mode === "workers" ? "agents" : mode;
}

/** The mode posted to the iOS app: one it knows */
export function nativeViewMode(mode: PaneViewMode): NativeViewMode {
  return mode === "agents" ? "workers" : mode;
}
