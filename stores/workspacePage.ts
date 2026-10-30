import { proxy } from "valtio";
import { subscribeKey } from "valtio/utils";
import { closeSettings, settingsPageStore } from "@/stores/settingsPage";

/** A page in the main area: what a phone sheet used to show */
export type WorkspacePage =
  | { kind: "project"; projectId: string }
  | { kind: "new"; projectId?: string; runAs?: "session" | "agent" }
  | { kind: "agent"; agentId: string }
  | { kind: "projectSettings"; projectId: string }
  | { kind: "inbox" }
  | { kind: "running" };

export type WorkspacePageKind = WorkspacePage["kind"];

/**
 * The page standing in for the panes (the right page on the open Duo, the
 * main column on the web, the whole screen on a phone). The panes stay
 * mounted under it. One level of history: a project's settings go back to
 * the project.
 */
export const workspacePageStore = proxy<{
  page: WorkspacePage | null;
  previous: WorkspacePage | null;
}>({ page: null, previous: null });

export function openPage(page: WorkspacePage) {
  // Settings is its own layer; only one of them shows
  closeSettings();
  workspacePageStore.previous = workspacePageStore.page;
  workspacePageStore.page = page;
}

/** The page before, or none */
export function backPage() {
  workspacePageStore.page = workspacePageStore.previous;
  workspacePageStore.previous = null;
}

/** Whether a page was open */
export function closePage(): boolean {
  const wasOpen = !!workspacePageStore.page;
  workspacePageStore.page = null;
  workspacePageStore.previous = null;
  return wasOpen;
}

// The other way round: Settings opening closes the page
subscribeKey(settingsPageStore, "open", (open) => {
  if (open) closePage();
});
