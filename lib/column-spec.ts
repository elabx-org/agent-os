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
  /** A sheet over the session other than Live activity (N-Undo, N-PermMode) */
  sheet?: "undo" | "permissions" | null;
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
    selected: ctx.viewMode === "git",
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

/** Closed-Chat / Open-Changes: back | the other view, Changes, Files, Live | More */
function sessionColumn(
  ctx: ColumnContext,
  compact: boolean,
  closed = false
): ColumnItem[] {
  if (closed) {
    const sheet = sheetColumn(ctx);
    if (sheet) return sheet;
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
  return [
    item(BASE.back),
    otherView(ctx, sep),
    changes(ctx),
    item(BASE.files, { selected: ctx.viewMode === "files" }),
    item(BASE.live, { selected: ctx.liveOpen }),
    item(BASE.more, sep),
  ];
}

/** Fold-Chat / Fold-Terminal: the view showing, Changes, Files, Live | Needs you, More */
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

const WIDE: LayoutMode[] = ["duo-open", "book", "desktop"];

/**
 * The items for a surface, top to bottom (or left to right), as the mocks
 * draw them: Main, Closed-Chat/Terminal/Settings/Project, E-Display,
 * E-Projects, E-NeedsYou, E-New, N-Search, Open-Now, Open-Beside,
 * Open-Changes, Fold-Chat/Terminal and E-iPhone.
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
