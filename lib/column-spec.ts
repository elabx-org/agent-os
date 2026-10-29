/**
 * What the control column holds on each surface, in each posture: one list
 * for the web column, the tabletop bar, the phone tab bar and (posted as
 * NativeState.column) the iOS app's own column, so they never disagree.
 */

import type { NavAction } from "@/lib/nav-actions";
import type { LayoutMode } from "@/hooks/useLayoutMode";
import type { PaneViewMode } from "@/stores/mobileNav";
import type { Surface } from "@/stores/surface";

export interface ColumnItem {
  id: NavAction;
  /** SF Symbol name, for the iOS app */
  symbol: string;
  /** lucide-react icon name (PascalCase), for the web */
  icon: string;
  label: string;
  badge?: number;
  /** amber: needs you; neutral: a plain count (changes) */
  badgeTone?: "amber" | "neutral";
  /** The filled accent circle (New) */
  prominent?: boolean;
  selected?: boolean;
  /** A separator before this item */
  sep?: true;
  /** Drawn red: Stop (N-Queue, E-Live) */
  danger?: boolean;
}

/** What the spec reads besides the surface and the posture */
export interface ColumnContext {
  /** The focused pane's view; null over the home or a page */
  viewMode: PaneViewMode | null;
  needsYou: number;
  changes: number;
  focus: boolean;
  /** An on-screen keyboard is up: the session column shrinks (Closed-Terminal) */
  keyboardUp: boolean;
  paneCount: number;
  /** A level to go back to within the surface (a Settings section, closed) */
  canGoBack: boolean;
  /** Inside the iOS app: Server is the app's own screen, so only there */
  native?: boolean;
  /** The live activity is showing (the column's Live item is on) */
  liveOpen?: boolean;
  /** The session in view is working: closed, Stop ends its column (N-Queue) */
  working?: boolean;
  /** A sheet over the session other than Live activity (N-Undo,
      N-PermMode, N-Scripts) */
  sheet?: "undo" | "permissions" | "scripts" | null;
  /** The project surface shows the project's settings (N-Config, M3) */
  projectSettings?: boolean;
  /** Agents the session started (its tree's total): the Agents item shows (O-Tree) */
  agents?: number;
  /** Finished agents show in the agents view (N-Tree's eye) */
  showFinished?: boolean;
  /** Every branch of the agents view is folded (N-Tree's Collapse all) */
  allCollapsed?: boolean;
  /** The closed agents view shows an agent's detail over its tree */
  agentDetail?: boolean;
  /** The open Duo's Changes page shows beside the conversation (Open-Changes) */
  changesOpen?: boolean;
}

type Base = Pick<ColumnItem, "id" | "symbol" | "icon" | "label">;

const BASE = {
  new: { id: "new", symbol: "plus", icon: "Plus", label: "New session" },
  inbox: { id: "inbox", symbol: "tray", icon: "Inbox", label: "Needs you" },
  now: {
    id: "now",
    symbol: "waveform.path.ecg",
    icon: "Activity",
    label: "Now",
  },
  projects: {
    id: "projects",
    symbol: "folder",
    icon: "Folder",
    label: "Projects",
  },
  search: {
    id: "search",
    symbol: "magnifyingglass",
    icon: "Search",
    label: "Find",
  },
  settings: {
    id: "settings",
    symbol: "gearshape",
    icon: "Settings",
    label: "Settings",
  },
  back: {
    id: "back",
    symbol: "chevron.left",
    icon: "ChevronLeft",
    label: "Back to Now",
  },
  closeSettings: {
    id: "closeSettings",
    symbol: "xmark",
    icon: "X",
    label: "Close settings",
  },
  server: { id: "server", symbol: "globe", icon: "Globe", label: "Server" },
  chat: {
    id: "chat",
    symbol: "bubble.left",
    icon: "MessageSquare",
    label: "Chat",
  },
  terminal: {
    id: "terminal",
    symbol: "terminal",
    icon: "Terminal",
    label: "Terminal",
  },
  git: {
    id: "git",
    symbol: "arrow.triangle.branch",
    icon: "GitBranch",
    label: "Changes",
  },
  files: { id: "files", symbol: "doc", icon: "Folder", label: "Files" },
  live: {
    id: "live",
    symbol: "waveform.path.ecg",
    icon: "Activity",
    label: "Live activity",
  },
  beside: {
    id: "beside",
    symbol: "rectangle.split.2x1",
    icon: "Columns2",
    label: "Open beside",
  },
  swap: {
    id: "swap",
    symbol: "arrow.left.arrow.right",
    icon: "ArrowRightLeft",
    label: "Swap sides",
  },
  more: { id: "more", symbol: "ellipsis", icon: "Ellipsis", label: "More" },
  stop: { id: "stop", symbol: "stop.fill", icon: "Square", label: "Interrupt" },
  closeSheet: {
    id: "closeSheet",
    symbol: "xmark",
    icon: "X",
    label: "Close",
  },
  done: {
    id: "done",
    symbol: "checkmark",
    icon: "Check",
    label: "Done",
  },
  sort: {
    id: "sort",
    symbol: "arrow.up.arrow.down",
    icon: "AlignLeft",
    label: "Edit order and groups",
  },
  notifSettings: {
    id: "notifSettings",
    symbol: "bell",
    icon: "Bell",
    label: "Notification settings",
  },
  clearHistory: {
    id: "clearHistory",
    symbol: "trash",
    icon: "Trash",
    label: "Clear history",
  },
  start: {
    id: "start",
    symbol: "checkmark",
    icon: "Check",
    label: "Start",
  },
  newProject: {
    id: "newProject",
    symbol: "plus",
    icon: "Plus",
    label: "New project",
  },
  projectSettings: {
    id: "projectSettings",
    symbol: "ellipsis",
    icon: "Ellipsis",
    label: "Project actions",
  },
  agents: {
    id: "agents",
    symbol: "point.3.connected.trianglepath.dotted",
    icon: "Workflow",
    label: "Agents",
  },
  showFinished: {
    id: "showFinished",
    symbol: "eye",
    icon: "Eye",
    label: "Show finished agents",
  },
  collapseAll: {
    id: "collapseAll",
    symbol: "arrow.down.and.line.horizontal.and.arrow.up",
    icon: "ChevronsDownUp",
    label: "Collapse all",
  },
  scripts: {
    id: "scripts",
    symbol: "play",
    icon: "Play",
    label: "Run a script",
  },
  viewConfig: {
    id: "viewConfig",
    symbol: "chevron.left.forwardslash.chevron.right",
    icon: "Code",
    label: "View .agent-os.json",
  },
  pull: {
    id: "pull",
    symbol: "arrow.down.to.line",
    icon: "ArrowDownToLine",
    label: "Pull",
  },
  push: {
    id: "push",
    symbol: "arrow.up.to.line",
    icon: "ArrowUpToLine",
    label: "Push",
  },
  newPr: {
    id: "newPr",
    symbol: "arrow.triangle.pull",
    icon: "GitPullRequestArrow",
    label: "New pull request",
  },
  newFile: {
    id: "newFile",
    symbol: "doc.badge.plus",
    icon: "FilePlus",
    label: "New file",
  },
  upload: {
    id: "upload",
    symbol: "square.and.arrow.up",
    icon: "Upload",
    label: "Upload",
  },
} satisfies Record<string, Base & { id: NavAction }>;

function item(base: Base, extra: Partial<ColumnItem> = {}): ColumnItem {
  const out: ColumnItem = { ...base, ...extra };
  // Only what's set: the app reads a missing key as off
  for (const key of Object.keys(out) as (keyof ColumnItem)[])
    if (out[key] === undefined || out[key] === false || out[key] === 0)
      delete out[key];
  return out;
}

const sep = { sep: true } as const;

/** Needs you, with its amber count (Focus keeps the column quiet) */
function inbox(ctx: ColumnContext, extra: Partial<ColumnItem> = {}) {
  const badge = ctx.focus ? 0 : ctx.needsYou;
  return item(BASE.inbox, {
    badge,
    badgeTone: badge ? "amber" : undefined,
    ...extra,
  });
}

function changes(ctx: ColumnContext, extra: Partial<ColumnItem> = {}) {
  const badge = ctx.focus ? 0 : ctx.changes;
  return item(BASE.git, {
    badge,
    badgeTone: badge ? "neutral" : undefined,
    selected: ctx.viewMode === "git" || !!ctx.changesOpen,
    ...extra,
  });
}

/** The other conversation view: Terminal from Chat, Chat from anything else */
function otherView(ctx: ColumnContext, extra: Partial<ColumnItem> = {}) {
  return ctx.viewMode === "chat"
    ? item(BASE.terminal, { label: "Show terminal", ...extra })
    : item(BASE.chat, { label: "Show chat", ...extra });
}

/**
 * The closed Duo's column under a sheet: close | Stop while it works
 * (E-Live), close | Changes over the undo sheet (N-Undo), close | Done
 * over the permissions sheet (N-PermMode); null when no sheet is up
 */
function sheetColumn(ctx: ColumnContext): ColumnItem[] | null {
  if (ctx.sheet === "scripts") return scriptsColumn();
  if (ctx.sheet === "undo")
    return [item(BASE.closeSheet), changes(ctx, { selected: false, ...sep })];
  if (ctx.sheet === "permissions")
    return [
      item(BASE.closeSheet),
      item(BASE.done, { prominent: true, ...sep }),
    ];
  if (ctx.liveOpen)
    return [
      item(BASE.closeSheet),
      ...(ctx.working ? [item(BASE.stop, { danger: true, ...sep })] : []),
    ];
  return null;
}

/** The column's Agents item, while the session has any or shows them */
function agents(ctx: ColumnContext, extra: Partial<ColumnItem> = {}) {
  const shown = ctx.viewMode === "agents";
  return shown || (ctx.agents ?? 0) > 0
    ? [item(BASE.agents, { selected: shown, ...extra })]
    : [];
}

/**
 * N-Tree: back to the Live activity | Show finished, Collapse all |
 * Interrupt while it works (the session only: workers and
 * background agents are stopped from their own detail); back to the tree
 * over an agent's detail
 */
function agentsColumn(ctx: ColumnContext): ColumnItem[] {
  if (ctx.agentDetail) return [item(BASE.back, { label: "Back to agents" })];
  return [
    item(BASE.back, { label: "Back to live activity" }),
    item(BASE.showFinished, { selected: ctx.showFinished, ...sep }),
    ctx.allCollapsed
      ? item(BASE.collapseAll, {
          symbol: "arrow.up.and.line.horizontal.and.arrow.down",
          icon: "ChevronsUpDown",
          label: "Expand all",
        })
      : item(BASE.collapseAll),
    ...(ctx.working ? [item(BASE.stop, { danger: true, ...sep })] : []),
  ];
}

/** N-Scripts: close | the project's settings, where the scripts are edited */
function scriptsColumn(): ColumnItem[] {
  return [
    item(BASE.closeSheet),
    item(BASE.projectSettings, {
      symbol: "gearshape",
      icon: "Settings",
      label: "Edit scripts",
      sep: true,
    }),
  ];
}

/**
 * The closed Duo's git and files views have their own column, back to the
 * conversation first: E-Git's Pull, Push, New pull request | More and
 * E-Files' New file, Upload | More (the keyboard up keeps the first two)
 */
function viewColumn(ctx: ColumnContext): ColumnItem[] | null {
  const back = item(BASE.back, { label: "Back to session" });
  if (ctx.viewMode === "git")
    return ctx.keyboardUp
      ? [back, item(BASE.pull, sep), item(BASE.push), item(BASE.more)]
      : [
          back,
          item(BASE.pull, sep),
          item(BASE.push),
          item(BASE.newPr),
          item(BASE.more, sep),
        ];
  if (ctx.viewMode === "files")
    return ctx.keyboardUp
      ? [back, item(BASE.newFile, sep), item(BASE.upload), item(BASE.more)]
      : [
          back,
          item(BASE.newFile, sep),
          item(BASE.upload),
          item(BASE.more, sep),
        ];
  return null;
}

/** Closed-Chat / Open-Changes: back | the other view, Changes, Files, Live | More */
function sessionColumn(
  ctx: ColumnContext,
  compact: boolean,
  closed = false
): ColumnItem[] {
  if (closed) {
    const own = sheetColumn(ctx) ?? viewColumn(ctx);
    if (own) return own;
    if (ctx.viewMode === "agents") return agentsColumn(ctx);
  }
  if (compact)
    // Closed-Terminal, keyboard up: what fits above it
    return [
      item(BASE.back, { label: "Back" }),
      otherView(ctx, sep),
      changes(ctx),
      item(BASE.more),
    ];
  if (closed && ctx.working)
    // N-Queue: while it works, Stop takes More's place
    return [
      item(BASE.back),
      otherView(ctx, sep),
      changes(ctx),
      item(BASE.live, { selected: ctx.liveOpen }),
      item(BASE.stop, { danger: true, ...sep }),
    ];
  // O-Tree: Agents beside Files on the open Duo, back to the session
  return [
    ctx.viewMode === "agents"
      ? item(BASE.back, { label: "Back to session" })
      : item(BASE.back),
    otherView(ctx, sep),
    changes(ctx),
    item(BASE.files, { selected: ctx.viewMode === "files" }),
    ...(closed ? [] : agents(ctx)),
    item(BASE.live, { selected: ctx.liveOpen }),
    item(BASE.more, sep),
  ];
}

/** Fold-Chat / Fold-Terminal: the view showing, Changes, Files, Agents, Live | Needs you, More */
function sessionBar(ctx: ColumnContext): ColumnItem[] {
  const conversation =
    ctx.viewMode === "terminal"
      ? item(BASE.terminal, { selected: true })
      : item(BASE.chat, { selected: ctx.viewMode === "chat" });
  const needs = !ctx.focus && ctx.needsYou > 0;
  return [
    conversation,
    changes(ctx),
    item(BASE.files, { selected: ctx.viewMode === "files" }),
    ...agents(ctx),
    item(BASE.live, { selected: ctx.liveOpen }),
    ...(needs ? [inbox(ctx, sep)] : []),
    item(BASE.more, needs ? {} : sep),
  ];
}

/** E-iPhone: Now · Needs you · Projects · Settings, then the New circle */
function tabs(surface: Surface, ctx: ColumnContext): ColumnItem[] {
  return [
    item(BASE.now, { selected: surface === "now" }),
    inbox(ctx, { selected: surface === "needs" }),
    item(BASE.projects, {
      selected: surface === "projects" || surface === "project",
    }),
    item(BASE.settings, { selected: surface === "settings" }),
    item(BASE.new, { prominent: true, sep: true }),
  ];
}

/** Main: New / Needs you / Projects / Find | Settings */
function nowColumn(ctx: ColumnContext): ColumnItem[] {
  return [
    item(BASE.new, { prominent: true }),
    // No Now item here: what needs you leads the page, so it's the one on
    inbox(ctx, { selected: !ctx.focus && ctx.needsYou > 0 }),
    item(BASE.projects),
    item(BASE.search),
    item(BASE.settings, sep),
  ];
}

/** Open-Now: New, Needs you | the other view, Changes, Files, Open beside | Find, More */
function nowWithSession(ctx: ColumnContext): ColumnItem[] {
  return [
    item(BASE.new, { prominent: true }),
    inbox(ctx),
    otherView(ctx, sep),
    changes(ctx),
    item(BASE.files, { selected: ctx.viewMode === "files" }),
    item(BASE.beside),
    item(BASE.search, sep),
    item(BASE.more),
  ];
}

/** Layouts with room for two pages: More offers Open beside */
export const WIDE: LayoutMode[] = ["duo-open", "book", "desktop"];

/**
 * The items for a surface, top to bottom (or left to right), as the mocks
 * draw them: Main, Closed-Chat/Terminal/Settings/Project, E-Display,
 * E-Projects, E-NeedsYou, E-New, N-Search, Open-Now, Open-Beside,
 * Open-Changes, Fold-Chat/Terminal, E-Git, E-Files and E-iPhone.
 */
export function columnFor(
  surface: Surface,
  mode: LayoutMode,
  ctx: ColumnContext
): ColumnItem[] {
  const wide = WIDE.includes(mode);
  const inSession = surface === "session" || surface === "beside";
  // The phone's tab bar holds the home's places; in a session the phone
  // gets the tabletop's bar of views
  // N-Scripts over a project page too (over a session, sessionColumn has it)
  if (mode === "duo-closed" && !inSession && ctx.sheet === "scripts")
    return scriptsColumn();
  if (mode === "phone" && !inSession) return tabs(surface, ctx);
  if ((mode === "phone" || mode === "tabletop") && inSession)
    return sessionBar(ctx);

  switch (surface) {
    case "now":
      return wide && ctx.viewMode ? nowWithSession(ctx) : nowColumn(ctx);
    case "session":
      return sessionColumn(
        ctx,
        mode === "duo-closed" && ctx.keyboardUp,
        mode === "duo-closed"
      );
    case "beside":
      return wide
        ? [
            item(BASE.back),
            item(BASE.beside, {
              label: "Side by side",
              selected: true,
              sep: true,
            }),
            item(BASE.swap),
            item(BASE.live, { selected: ctx.liveOpen }),
            item(BASE.more, sep),
          ]
        : sessionColumn(
            ctx,
            mode === "duo-closed" && ctx.keyboardUp,
            mode === "duo-closed"
          );
    case "settings":
      // Drilled into a section on the closed Duo (E-Display); list | detail
      // elsewhere keeps both up, so there's nothing to go back to
      if (ctx.canGoBack && !wide)
        return [item(BASE.back, { label: "Back to Settings" })];
      return [
        item(BASE.closeSettings),
        ...(ctx.native ? [item(BASE.server, sep)] : []),
      ];
    case "projects":
      return [
        item(BASE.back),
        item(BASE.newProject, { prominent: true, sep: true }),
        item(BASE.search, { label: "Find a project" }),
        item(BASE.sort),
      ];
    case "project":
      // N-Config: back | run a script, the file
      if (ctx.projectSettings)
        return [
          item(BASE.back, { label: "Back" }),
          item(BASE.scripts, sep),
          item(BASE.viewConfig),
        ];
      return [
        item(BASE.back, { label: "Back" }),
        item(BASE.new, { prominent: true, sep: true }),
        item(BASE.search, { label: "Find in project" }),
        item(BASE.projectSettings, sep),
      ];
    case "needs":
      return [
        item(BASE.back),
        item(BASE.notifSettings, sep),
        item(BASE.clearHistory),
      ];
    case "new":
      // E-New: Cancel | Start (the form registers startNew)
      return [
        item(BASE.back, { symbol: "xmark", icon: "X", label: "Cancel" }),
        item(BASE.start, { prominent: true, sep: true }),
      ];
    case "search":
      return [item(BASE.back)];
  }
}
