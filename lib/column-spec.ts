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
      N-Switch, N-PermMode, N-Scripts) */
  sheet?: "undo" | "switch" | "permissions" | "scripts" | "move" | null;
  /**
   * What the move sheet (N-Worktree) can do now: move, cancel the
   * scheduled move, or nothing (loading, refused, running). Absent: move
   */
  sheetAction?: "move" | "cancel" | "none";
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
  /** A session waits behind Now (closed Duo, tabletop): Now leads with back to it */
  behind?: boolean;
  /** The person's own order (Settings → Control column); none keeps the default */
  order?: ColumnOrder;
  /** Where back goes, as lib/nav-actions.ts backTarget() names it */
  backLabel?: string;
  /** Settings opened from Needs you: it closes back to it */
  settingsFrom?: "needs";
}

/**
 * The columns a person can arrange (Settings → Control column): a session's,
 * two side by side, and Now's. Back stays first and More (Now: Settings)
 * last; what's taken out is offered in More.
 */
export type ColumnKind = "session" | "beside" | "now";

/** What can go between them; "view" is the other conversation view */
export type ColumnSlot =
  | "view"
  | "git"
  | "files"
  | "live"
  | "inbox"
  | "new"
  | "search"
  | "beside"
  | "swap"
  | "projects";

export type ColumnOrder = Partial<Record<ColumnKind, ColumnSlot[]>>;

export const COLUMN_DEFAULTS: Record<ColumnKind, ColumnSlot[]> = {
  session: ["view", "git", "files", "live"],
  beside: ["beside", "swap", "live"],
  now: ["new", "inbox", "projects", "search"],
};

/** Everything each column can hold, defaults first */
export const COLUMN_CHOICES: Record<ColumnKind, ColumnSlot[]> = {
  session: [
    ...COLUMN_DEFAULTS.session,
    "inbox",
    "new",
    "search",
    "beside",
    "projects",
  ],
  beside: [...COLUMN_DEFAULTS.beside, "git", "files", "inbox", "new", "search"],
  now: [...COLUMN_DEFAULTS.now],
};

/** The saved order for a column, cleaned of anything it can't hold; null: the default */
export function savedOrder(
  kind: ColumnKind,
  order: ColumnOrder | undefined
): ColumnSlot[] | null {
  const saved = order?.[kind];
  if (!Array.isArray(saved)) return null;
  const choices = COLUMN_CHOICES[kind];
  return saved.filter(
    (slot, i) => choices.includes(slot) && saved.indexOf(slot) === i
  );
}

/** What the column leaves out (the default's too: New and Find), for More to offer */
export function hiddenSlots(
  kind: ColumnKind,
  order: ColumnOrder | undefined
): ColumnSlot[] {
  const shown = savedOrder(kind, order) ?? COLUMN_DEFAULTS[kind];
  return COLUMN_CHOICES[kind].filter((slot) => !shown.includes(slot));
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
  running: {
    id: "running",
    symbol: "play.rectangle",
    icon: "MonitorPlay",
    label: "Running",
  },
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
  resume: {
    id: "resume",
    symbol: "chevron.left",
    icon: "ChevronLeft",
    label: "Back to session",
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
  moveSession: {
    id: "done",
    symbol: "arrow.triangle.branch",
    icon: "GitBranch",
    label: "Move session",
  },
  cancelMove: {
    id: "done",
    symbol: "arrow.uturn.backward",
    icon: "Undo2",
    label: "Cancel move",
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
    symbol: "folder.badge.gearshape",
    icon: "FolderCog",
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
  settle: {
    id: "settle",
    symbol: "checkmark.circle",
    icon: "CircleCheck",
    label: "Settle",
  },
  copyId: {
    id: "copyId",
    symbol: "doc.on.doc",
    icon: "Copy",
    label: "Copy session ID",
  },
} satisfies Record<string, Base & { id: NavAction }>;

/**
 * More's Agents: the closed column and an arranged one leave the item out,
 * so a session's agents tree stays reachable from More
 */
export function agentsMoreItem(
  agents: number,
  live: number,
  viewMode: ColumnContext["viewMode"]
): Base | null {
  if (agents <= 0 || viewMode === "agents") return null;
  // The number is what still runs; finished ones are history
  return live > 0 ? { ...BASE.agents, label: `Agents (${live})` } : BASE.agents;
}

function item(base: Base, extra: Partial<ColumnItem> = {}): ColumnItem {
  const out: ColumnItem = { ...base, ...extra };
  // Only what's set: the app reads a missing key as off
  for (const key of Object.keys(out) as (keyof ColumnItem)[])
    if (out[key] === undefined || out[key] === false || out[key] === 0)
      delete out[key];
  return out;
}

const sep = { sep: true } as const;

/** Back, named for where it goes; the fallback where nothing says */
function back(ctx: ColumnContext, fallback?: string): ColumnItem {
  const label = ctx.backLabel ?? fallback;
  return item(BASE.back, label ? { label } : {});
}

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
  // N-Switch: the close alone
  if (ctx.sheet === "switch") return [item(BASE.closeSheet)];
  if (ctx.sheet === "permissions")
    return [
      item(BASE.closeSheet),
      item(BASE.done, { prominent: true, ...sep }),
    ];
  // N-Worktree: close | Move session; close | Cancel move once it waits
  // for the turn; the close alone while there is nothing to do
  if (ctx.sheet === "move") {
    const action = ctx.sheetAction ?? "move";
    if (action === "none") return [item(BASE.closeSheet)];
    return [
      item(BASE.closeSheet),
      action === "cancel"
        ? item(BASE.cancelMove, sep)
        : item(BASE.moveSession, { prominent: true, ...sep }),
    ];
  }
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
  const backItem = back(ctx, "Back to session");
  if (ctx.viewMode === "git")
    return ctx.keyboardUp
      ? [backItem, item(BASE.pull, sep), item(BASE.push), item(BASE.more)]
      : [
          backItem,
          item(BASE.pull, sep),
          item(BASE.push),
          item(BASE.newPr),
          item(BASE.more, sep),
        ];
  if (ctx.viewMode === "files")
    return ctx.keyboardUp
      ? [backItem, item(BASE.newFile, sep), item(BASE.upload), item(BASE.more)]
      : [
          backItem,
          item(BASE.newFile, sep),
          item(BASE.upload),
          item(BASE.more, sep),
        ];
  return null;
}

/** One slot of an arranged column, as that column draws it */
function slotItem(
  slot: ColumnSlot,
  kind: ColumnKind,
  ctx: ColumnContext
): ColumnItem {
  switch (slot) {
    case "view":
      return otherView(ctx);
    case "git":
      return changes(ctx);
    case "files":
      return item(BASE.files, { selected: ctx.viewMode === "files" });
    case "live":
      return item(BASE.live, { selected: ctx.liveOpen });
    case "inbox":
      return inbox(ctx);
    case "new":
      return item(BASE.new, { prominent: true });
    case "search":
      return item(BASE.search);
    case "beside":
      return kind === "beside"
        ? item(BASE.beside, { label: "Side by side", selected: true })
        : item(BASE.beside);
    case "swap":
      return item(BASE.swap);
    case "projects":
      return item(BASE.projects);
  }
}

/** The slot a view is: More never offers the view showing */
const VIEW_SLOT: Partial<
  Record<NonNullable<ColumnContext["viewMode"]>, ColumnSlot>
> = {
  git: "git",
  files: "files",
};

/** What the closed Duo's session column keeps with the keyboard up (sessionColumn) */
const KEYBOARD_SLOTS: ColumnSlot[] = ["view", "git"];

/** Slots for two sessions side by side: one page has no room for them */
const BESIDE_SLOTS: ColumnSlot[] = ["beside", "swap"];

/** A saved order as one page shows it */
function onePage(slots: ColumnSlot[]): ColumnSlot[] {
  return slots.filter((slot) => !BESIDE_SLOTS.includes(slot));
}

/**
 * What the column leaves out, as items for More (most menus skip ones they
 * already list). With the keyboard up the closed Duo's session column is
 * cut to KEYBOARD_SLOTS whatever the saved order, so More has the rest. On
 * one page (not `wide`) there's no Open beside
 */
export function moreItems(
  kind: ColumnKind,
  order: ColumnOrder | undefined,
  viewMode: ColumnContext["viewMode"] = null,
  keyboardUp = false,
  wide = true
): ColumnItem[] {
  const ctx: ColumnContext = {
    viewMode,
    needsYou: 0,
    changes: 0,
    focus: false,
    keyboardUp: false,
    paneCount: 1,
    canGoBack: false,
  };
  const current = viewMode ? VIEW_SLOT[viewMode] : undefined;
  const hidden = keyboardUp
    ? COLUMN_CHOICES[kind].filter((slot) => !KEYBOARD_SLOTS.includes(slot))
    : hiddenSlots(kind, order);
  return (wide ? hidden : onePage(hidden))
    .filter((slot) => slot !== current)
    .map((slot) => {
      const {
        sep: _sep,
        selected: _selected,
        prominent: _prominent,
        ...rest
      } = slotItem(slot, kind, ctx);
      return rest;
    });
}

/** What More adds to what the column leaves out, where it shows */
export interface MoreSources {
  surface: Surface;
  viewMode: ColumnContext["viewMode"];
  /** What the column (or bar) shows already */
  shown: NavAction[];
  /** Labs' Running is on */
  running: boolean;
  /** The focused session's ⋯ (stores/sessionActions.ts) */
  session: { scripts: boolean; settle: boolean; copyId: boolean };
}

/**
 * The conversation view the column can't reach from Changes or Files, the
 * focused session's own actions (its header's ⋯ is often hidden), and
 * Running unless it's the page showing; for the web's More and the app's
 */
export function moreExtras(src: MoreSources): Base[] {
  const inSession = src.surface === "session" || src.surface === "beside";
  const out: Base[] = [];
  const conversation = src.viewMode === "chat" || src.viewMode === "terminal";
  if (inSession && src.viewMode && !conversation) {
    if (!src.shown.includes("chat")) out.push(BASE.chat);
    if (!src.shown.includes("terminal")) out.push(BASE.terminal);
  }
  if (inSession) {
    if (src.session.scripts) out.push({ ...BASE.scripts, label: "Scripts" });
    if (src.session.settle) out.push(BASE.settle);
    if (src.session.copyId) out.push(BASE.copyId);
  }
  if (src.running && src.surface !== "running") out.push(BASE.running);
  return out.filter((it) => !src.shown.includes(it.id));
}

/** The arranged slots between the pinned ends, the first one set apart from back */
function arranged(
  kind: ColumnKind,
  slots: ColumnSlot[],
  ctx: ColumnContext,
  afterBack: boolean
): ColumnItem[] {
  return slots.map((slot, i) => {
    const it = slotItem(slot, kind, ctx);
    return i === 0 && afterBack ? { ...it, sep: true as const } : it;
  });
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
    // Closed-Terminal, keyboard up: what fits above it, whatever the saved
    // order, so the other view and Changes stay a tap away
    return [
      item(BASE.back, { label: "Back" }),
      otherView(ctx, sep),
      changes(ctx),
      item(BASE.more),
    ];
  const saved = savedOrder("session", ctx.order);
  const own = saved && closed ? onePage(saved) : saved;
  // N-Queue: while it works, Stop stands before More (never in its place)
  const end = [
    ...(closed && ctx.working
      ? [item(BASE.stop, { danger: true, ...sep })]
      : []),
    item(BASE.more, closed && ctx.working ? {} : sep),
  ];
  if (own) {
    // Changes or Files left out of it still shows, picked, while it's up
    const current = ctx.viewMode ? VIEW_SLOT[ctx.viewMode] : undefined;
    const slots = current && !own.includes(current) ? [...own, current] : own;
    return [back(ctx), ...arranged("session", slots, ctx, true), ...end];
  }
  if (closed && ctx.working)
    // Files makes room for Stop
    return [
      back(ctx),
      otherView(ctx, sep),
      changes(ctx),
      item(BASE.live, { selected: ctx.liveOpen }),
      ...end,
    ];
  // O-Tree: Agents beside Files on the open Duo, back to the session
  return [
    back(ctx, ctx.viewMode === "agents" ? "Back to session" : undefined),
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
  const saved = savedOrder("session", ctx.order);
  const own = saved && onePage(saved);
  if (own) {
    // The bar has no back: the view showing stands where "view" was put
    const shown = own.map((slot) =>
      slot === "view"
        ? ctx.viewMode === "terminal"
          ? item(BASE.terminal, { selected: true })
          : item(BASE.chat, { selected: ctx.viewMode === "chat" })
        : slotItem(slot, "session", ctx)
    );
    const needs = !ctx.focus && ctx.needsYou > 0 && !own.includes("inbox");
    return [
      ...shown,
      ...(needs ? [inbox(ctx, sep)] : []),
      item(BASE.more, needs ? {} : sep),
    ];
  }
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

/**
 * E-iPhone: Now · Needs you · Projects · Find · Settings, then the New
 * circle (Find as in Main's column: a phone has no sidebar to hold it)
 */
function tabs(surface: Surface, ctx: ColumnContext): ColumnItem[] {
  return [
    item(BASE.now, { selected: surface === "now" }),
    inbox(ctx, { selected: surface === "needs" }),
    item(BASE.projects, {
      selected: surface === "projects" || surface === "project",
    }),
    item(BASE.search, { selected: surface === "search" }),
    item(BASE.settings, { selected: surface === "settings" }),
    item(BASE.new, { prominent: true, sep: true }),
  ];
}

/**
 * Main: New / Needs you / Projects / Find | Settings. In the iOS app the end
 * is More, whose menu holds Settings with Focus, Reload and Server; with a
 * session behind Now, back to it leads
 */
function nowColumn(ctx: ColumnContext): ColumnItem[] {
  const own = savedOrder("now", ctx.order);
  const slots = own
    ? arranged("now", own, ctx, false)
    : [
        item(BASE.new, { prominent: true }),
        // Only its count: it opens a page of its own, which isn't this one
        inbox(ctx),
        item(BASE.projects),
        item(BASE.search),
      ];
  const back = ctx.behind ? [item(BASE.resume)] : [];
  const end = ctx.native ? item(BASE.more, sep) : item(BASE.settings, sep);
  return [
    ...back,
    ...slots.map((it, i) =>
      i === 0 && back.length ? { ...it, sep: true as const } : it
    ),
    end,
  ];
}

/**
 * Open-Now: New, Needs you, Projects | the other view, Changes, Files, Open
 * beside | Find, More
 */
function nowWithSession(ctx: ColumnContext): ColumnItem[] {
  return [
    // Now beside the session: ‹ puts it away, the session takes both pages
    item(BASE.resume),
    item(BASE.new, { prominent: true, sep: true }),
    inbox(ctx),
    item(BASE.projects),
    otherView(ctx, sep),
    changes(ctx),
    item(BASE.files, { selected: ctx.viewMode === "files" }),
    item(BASE.beside),
    item(BASE.search, sep),
    item(BASE.more),
  ];
}

/** The arranged column a surface shows, if any (More offers what it leaves out) */
export function columnKindFor(
  surface: Surface,
  mode: LayoutMode
): ColumnKind | null {
  if (surface === "session") return "session";
  if (surface === "beside") return WIDE.includes(mode) ? "beside" : "session";
  if (surface === "now") return "now";
  return null;
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
  // gets the tabletop's bar of views (ControlColumn's PhoneBar draws it)
  // N-Scripts over a project page too (over a session, sessionColumn has it)
  if (mode === "duo-closed" && !inSession && ctx.sheet === "scripts")
    return scriptsColumn();
  // N-Worktree from a project page's row: × | Move session there too; on
  // the open Duo the sheet stops at the column, which offers the same
  if (
    ctx.sheet === "move" &&
    ((mode === "duo-closed" && !inSession) ||
      mode === "duo-open" ||
      mode === "book")
  )
    return sheetColumn(ctx) ?? [];
  if (mode === "phone" && !inSession) return tabs(surface, ctx);
  if ((mode === "phone" || mode === "tabletop") && inSession)
    return sessionBar(ctx);

  switch (surface) {
    case "now":
      // A session's views only beside a session, not a bare shell
      if (wide && ctx.viewMode && ctx.behind) return nowWithSession(ctx);
      // Wide, Now is a page beside the session: nothing to go back to
      return nowColumn(wide ? { ...ctx, behind: false } : ctx);
    case "session":
      return sessionColumn(
        ctx,
        mode === "duo-closed" && ctx.keyboardUp,
        mode === "duo-closed"
      );
    case "beside":
      if (wide && savedOrder("beside", ctx.order))
        return [
          back(ctx),
          ...arranged("beside", savedOrder("beside", ctx.order)!, ctx, true),
          item(BASE.more, sep),
        ];
      return wide
        ? [
            back(ctx),
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
      if (ctx.canGoBack && !wide) return [back(ctx, "Back to Settings")];
      return [
        // Opened from Needs you, it goes back there
        ctx.settingsFrom
          ? back(ctx, "Back to Needs you")
          : item(BASE.closeSettings),
        ...(ctx.native ? [item(BASE.server, sep)] : []),
      ];
    case "projects":
      return [
        back(ctx),
        item(BASE.newProject, { prominent: true, sep: true }),
        item(BASE.search, { label: "Find a project" }),
        item(BASE.sort),
        item(BASE.more, sep),
      ];
    case "project":
      // N-Config: back | run a script, the file
      if (ctx.projectSettings)
        return [
          back(ctx, "Back"),
          item(BASE.scripts, sep),
          item(BASE.viewConfig),
          item(BASE.more, sep),
        ];
      return [
        back(ctx, "Back"),
        item(BASE.new, { prominent: true, sep: true }),
        item(BASE.search, { label: "Find in project" }),
        item(BASE.projectSettings, sep),
        item(BASE.more),
      ];
    case "needs":
      return [
        back(ctx),
        item(BASE.notifSettings, sep),
        item(BASE.clearHistory),
        item(BASE.more, sep),
      ];
    case "new":
      // E-New: Cancel | Start (the form registers startNew)
      return [
        item(BASE.back, { symbol: "xmark", icon: "X", label: "Cancel" }),
        item(BASE.start, { prominent: true, sep: true }),
        item(BASE.more, sep),
      ];
    case "search":
      return [back(ctx), item(BASE.more, sep)];
    case "running":
      // Its own page, not the session's: back (to the session it was
      // opened from) | More (the list has Show all itself)
      return [back(ctx), item(BASE.more, sep)];
  }
}

/** A slot as Settings lists it: its web icon and name */
export function slotLabel(slot: ColumnSlot): { icon: string; label: string } {
  if (slot === "view")
    return { icon: "MessageSquare", label: "Terminal / Chat" };
  const base = slotItem(slot, "session", {
    viewMode: null,
    needsYou: 0,
    changes: 0,
    focus: false,
    keyboardUp: false,
    paneCount: 1,
    canGoBack: false,
  });
  return { icon: base.icon, label: base.label };
}
