import { subscribe } from "valtio";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { runningStore } from "@/stores/running";
import {
  openSettings,
  settingsPageStore,
  type SettingsSection,
} from "@/stores/settingsPage";
import { surfaceStore } from "@/stores/surface";
import { workspacePageStore, type WorkspacePage } from "@/stores/workspacePage";

/**
 * Where you were, for a reload: the panes and their sessions come back on
 * their own (PaneContext), this is what lies over them. sessionStorage, so
 * this tab only, and a new tab starts as usual
 */
export interface Place {
  /** Now (the phone's home layer, the Duo's left page, the sidebar) */
  home: boolean;
  homeTab: "now" | "projects";
  page: WorkspacePage | null;
  previous: WorkspacePage | null;
  inbox: boolean;
  find: boolean;
  settings: { section: SettingsSection; detail: boolean } | null;
  /** The focused session's Changes or Files */
  view: { sessionId: string; mode: "git" | "files" } | null;
}

const KEY = "agentos:place";

const PAGE_KINDS = new Set<string>([
  "project",
  "new",
  "agent",
  "projectSettings",
  "inbox",
  "running",
]);

function pageOf(value: unknown): WorkspacePage | null {
  if (!value || typeof value !== "object") return null;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && PAGE_KINDS.has(kind)
    ? (value as WorkspacePage)
    : null;
}

/** A saved place, or null when there is none or it isn't one */
export function parsePlace(raw: string | null): Place | null {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const settings = v.settings as Place["settings"] | undefined;
  const view = v.view as Place["view"] | undefined;
  return {
    home: v.home === true,
    homeTab: v.homeTab === "projects" ? "projects" : "now",
    page: pageOf(v.page),
    previous: pageOf(v.previous),
    inbox: v.inbox === true,
    find: v.find === true,
    settings:
      settings && typeof settings.section === "string"
        ? { section: settings.section, detail: !!settings.detail }
        : null,
    view:
      view &&
      typeof view.sessionId === "string" &&
      (view.mode === "git" || view.mode === "files")
        ? { sessionId: view.sessionId, mode: view.mode }
        : null,
  };
}

/** Where you are now, from the stores */
function currentPlace(): Place {
  const mode = mobileNavStore.viewMode;
  const sessionId = runningStore.sessionId;
  return {
    home: surfaceStore.home,
    homeTab: mobileNavStore.homeTab,
    page: workspacePageStore.page,
    previous: workspacePageStore.previous,
    inbox: mobileNavStore.inboxOpen,
    find: surfaceStore.searchOpen,
    settings: settingsPageStore.open
      ? {
          section: settingsPageStore.section,
          detail: settingsPageStore.detail,
        }
      : null,
    view:
      sessionId && (mode === "git" || mode === "files")
        ? { sessionId, mode }
        : null,
  };
}

/** The place the last load of this tab left, once (null after) */
let taken = false;
export function takePlace(): Place | null {
  if (taken) return null;
  taken = true;
  try {
    return parsePlace(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/**
 * Puts the layers back (app/page.tsx puts back the home and Find, its own
 * state); the view opens once its session has attached
 */
export function restorePlace(place: Place) {
  mobileNavStore.homeTab = place.homeTab;
  if (place.settings) {
    openSettings(place.settings.section);
    settingsPageStore.detail = place.settings.detail;
  } else if (place.page) {
    workspacePageStore.page = place.page;
    workspacePageStore.previous = place.previous;
  }
  if (place.inbox) mobileNavActions.setInboxOpen(true);
  if (place.view)
    mobileNavActions.requestViewMode(place.view.mode, place.view.sessionId);
}

/** Keeps the place saved from now on (after it was restored) */
export function keepPlace(): void {
  let last = "";
  const save = () => {
    const json = JSON.stringify(currentPlace());
    if (json === last) return;
    last = json;
    try {
      sessionStorage.setItem(KEY, json);
    } catch {
      // Not kept for a reload
    }
  };
  save();
  for (const store of [
    surfaceStore,
    mobileNavStore,
    workspacePageStore,
    settingsPageStore,
    runningStore,
  ])
    subscribe(store, save);
}
