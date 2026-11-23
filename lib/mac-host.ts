/**
 * Inside the Mac app's window. The app says so in its user agent
 * (MacChrome/<n>), draws the toolbar itself and reads what the toolbar
 * shows from window.__agentosMac; the page lays itself out as floating
 * panes. The page still can't reach native code: the app only reads this
 * state and sends the fixed actions below.
 */

/**
 * Sets html[data-mac] before paint, and data-mac-opaque when the app says
 * its window can't be seen through (the page then keeps a ground of its own)
 */
export const MAC_BOOT_SCRIPT = `(function(){try{var u=navigator.userAgent,d=document.documentElement,m=/\\bMacChrome\\/(\\d+)/.exec(u);if(m){d.setAttribute("data-mac",m[1]);if(/\\bMacOpaque\\/\\d+/.test(u))d.setAttribute("data-mac-opaque","")}}catch(e){}})()`;

/** The window chrome's version in a user agent; 0 outside the Mac app */
export function macChrome(userAgent: string): number {
  const match = /\bMacChrome\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : 0;
}

export function isMacApp(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.hasAttribute("data-mac")
  );
}

/** What the toolbar's buttons send (the "agentos-mac" event's action) */
export const MAC_ACTIONS = [
  "chat",
  "changes",
  "terminal",
  "files",
  "agents",
  "sidebar",
  "inspector",
  "find",
  "new",
  "settings",
] as const;
export type MacAction = (typeof MAC_ACTIONS)[number];

export function isMacAction(value: unknown): value is MacAction {
  return (
    typeof value === "string" &&
    (MAC_ACTIONS as readonly string[]).includes(value)
  );
}

export type MacView = "chat" | "changes" | "terminal" | "files" | "agents";

/** What the Mac window's toolbar shows; read by the app, never sent */
export interface MacState {
  v: 1;
  /** The session in front; null on a page, Settings or with none open */
  session: string | null;
  title: string;
  /** "fusionha-ios · main · Mac Studio" */
  detail: string;
  view: MacView | null;
  /** Changed files in the session's folder */
  changes: number;
  /** The session has background agents: the toolbar offers Agents */
  agents: boolean;
  sidebar: boolean;
  inspector: boolean;
  dark: boolean;
  /** Sessions and agents waiting for the person */
  needs: number;
}

const VIEW: Record<string, MacView> = {
  chat: "chat",
  terminal: "terminal",
  git: "changes",
  files: "files",
  agents: "agents",
  workers: "agents",
};

export function macView(mode: string | null | undefined): MacView | null {
  return (mode && VIEW[mode]) || null;
}

export interface MacStateInput {
  session: { id: string; title: string; branch?: string | null } | null;
  project?: string | null;
  machine?: string | null;
  /** A workspace page, Settings or New covers the session */
  covered: string | null;
  viewMode: string | null;
  changes: number;
  agents: number;
  sidebar: boolean;
  inspector: boolean;
  dark: boolean;
  needs: number;
}

const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function macState(input: MacStateInput): MacState {
  const { session, covered } = input;
  const front = session && !covered ? session : null;
  const detail = front
    ? [input.project, session?.branch, input.machine]
        .filter((part): part is string => !!part)
        .join(" · ")
    : (input.machine ?? "");
  return {
    v: 1,
    session: front ? front.id : null,
    title: front ? front.title : (covered ?? ""),
    detail,
    view: front ? macView(input.viewMode) : null,
    changes: front ? whole(input.changes) : 0,
    agents: !!front && input.agents > 0,
    sidebar: input.sidebar,
    inspector: input.inspector,
    dark: input.dark,
    needs: whole(input.needs),
  };
}

declare global {
  interface Window {
    __agentosMac?: MacState;
  }
}

/** Publishes the state for the app to read; true when it changed */
export function publishMacState(state: MacState): boolean {
  const before = JSON.stringify(window.__agentosMac ?? null);
  if (before === JSON.stringify(state)) return false;
  window.__agentosMac = state;
  window.dispatchEvent(new Event("agentos-mac-state"));
  return true;
}
