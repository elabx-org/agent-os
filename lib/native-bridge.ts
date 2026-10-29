/**
 * Talks to the native iOS app (ios/) when Agent-OS runs inside it.
 *
 * The app injects `window.agentosNative` before the page loads and owns the
 * navigation (the system's vertical bar on iPhone Duo) and the keyboard's
 * accessory keys. Native -> web arrives as `agentos-native` events; web ->
 * native goes through the `agentos` script message handler.
 */

import type { NativeViewMode } from "@/lib/agent-views";
import type { Fold } from "@/stores/posture";
import type { NavAction } from "@/lib/nav-actions";
import type { WorkspacePageKind } from "@/stores/workspacePage";
import type { ColumnItem } from "@/lib/column-spec";
import type { Surface } from "@/stores/surface";

export type NativeNavAction = NavAction;

export type NativeEvent =
  | { type: "nav"; action: NativeNavAction }
  /** A key from the keyboard's accessory bar, as terminal input */
  | { type: "key"; key: string }
  /** Text from the bar's system Paste button */
  | { type: "paste"; text: string }
  /** The bar's Add image button (or its Photo key) */
  | { type: "image" }
  /** The bar's Copy key: select text on the screen */
  | { type: "select" }
  /** The bar's File key: the snippets sheet */
  | { type: "snippets" }
  | { type: "keyboard"; visible: boolean }
  /** The fold while half open, in the page's CSS pixels */
  | { type: "posture"; fold: Fold | null }
  /** Open a session: a tapped notification or an agentos://session/<id> link */
  | { type: "open"; sessionId: string }
  /** A file shared to the app ("Open in Agent-OS"), for the focused session */
  | { type: "file"; file: SharedFile }
  /** The minimised Safari pages changed; `closed`: one just closed (Undo) */
  | { type: "browser"; count: number; closed?: BrowserPage };

/** A page opened from a link, kept in the column's Pages menu */
export interface BrowserPage {
  id: string;
  url: string;
  title: string;
}

export interface SharedFile {
  name: string;
  mimeType: string;
  base64: string;
}

export interface NativeState {
  type: "state";
  /** Only modes iOS app 0.1.62 knows: agents is posted as workers */
  viewMode: NativeViewMode;
  waiting: number;
  changes: number;
  /** The page's background (getComputedStyle), for the edges the app shows around it */
  background?: string;
  /** The Settings page is showing (older app builds ignore it) */
  settings?: boolean;
  /** The workspace page showing, if any (older app builds ignore it) */
  page?: WorkspacePageKind;
  /** Focus mode is on (stores/focus.ts) */
  focus?: boolean;
  /** Focus is on and something needs you: the amber dot on the toggle */
  focusDot?: boolean;
  /** The theme's accent (--primary) as rgb(), for the app's own controls */
  accent?: string;
  scheme?: "light" | "dark";
  /** What fills the screen (older app builds ignore it) */
  surface?: Surface;
  /**
   * The column for this surface (lib/column-spec.ts), for app builds that
   * draw it (agentosNative.column). Only ever sent to those builds; an
   * explicit [] hides the native column, absent keeps the fixed one
   */
  column?: NativeColumnItem[];
  /** The column's first item is back */
  canGoBack?: boolean;
}

/** A column item as the app gets it: the SF Symbol, not the web icon */
export type NativeColumnItem = Omit<ColumnItem, "icon">;

export const NATIVE_EVENT = "agentos-native";

declare global {
  interface Window {
    agentosNative?: {
      platform: string;
      version: string;
      /** The keyboard bar takes `id/flick/hold` key specs */
      keySpecs?: boolean;
      fold?: Fold | null;
      /** Running on an iPhone Duo (app builds that say; else guessed by size) */
      duo?: boolean;
      /** A session to open, set when a link launched the app */
      open?: string;
      /** A file shared to the app before the page was ready */
      file?: SharedFile;
      /** The app draws the column from NativeState.column (the M14 build) */
      column?: boolean;
    };
    webkit?: {
      messageHandlers?: Record<string, { postMessage: (msg: unknown) => void }>;
    };
  }
}

export function isNative(): boolean {
  return typeof window !== "undefined" && !!window.agentosNative;
}

/** What this app build can do; all false in a browser */
export interface NativeCaps {
  /**
   * Draws NativeState.column, and hides its bar for an empty one: the page
   * then draws its own tab bar or tabletop bar. Without it the web draws no
   * bar inside the app
   */
  column: boolean;
}

export function nativeCaps(): NativeCaps {
  return {
    column: typeof window !== "undefined" && !!window.agentosNative?.column,
  };
}

/**
 * The theme's accent as rgb(): a probe styled with --primary, through a
 * canvas when the browser reports a colour space (oklch) the app can't read
 */
export function themeAccent(): string | undefined {
  const probe = document.createElement("span");
  probe.style.cssText = "display:none;color:hsl(var(--primary))";
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  if (!color || color.startsWith("rgb")) return color || undefined;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Keys from the bar that are text (/, @, a new line) rather than terminal controls */
export function isTextKey(key: string): boolean {
  return key === "\n" || /^[^\x00-\x1f\x7f]+$/.test(key);
}

/** The page's own key rows stand in for the keyboard bar (laptop pose) */
export interface NativeKeybar {
  type: "keybar";
  hidden: boolean;
}

/** A tap felt through the iOS app (older app builds ignore it) */
export interface NativeHaptic {
  type: "haptic";
  style: HapticStyle;
}

export type HapticStyle =
  | "light"
  | "medium"
  | "rigid"
  | "selection"
  | "success"
  | "warning"
  | "error";

/** Which key rows the page would show, for the keyboard bar's own */
export interface NativeKeys {
  type: "keys";
  context: "claude" | "claude-up" | "shell" | "chat";
  /** The row's keys in order (ToolbarButtonId, ^C already pinned), as set
      in Settings → Keys; older pages send none */
  ids?: string[];
}

/** Undo closing a page from the column's Pages menu */
export interface NativeBrowser {
  type: "browser";
  action: "undo";
}

/** Settings → Server: the app's own server and sign-in screen */
export interface NativeServer {
  type: "server";
}

export function postToNative(
  message:
    | NativeState
    | NativeKeybar
    | NativeHaptic
    | NativeServer
    | NativeKeys
    | NativeBrowser
): void {
  window.webkit?.messageHandlers?.agentos?.postMessage(message);
}

export function onNativeEvent(
  handler: (event: NativeEvent) => void
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<NativeEvent>).detail);
  window.addEventListener(NATIVE_EVENT, listener);
  return () => window.removeEventListener(NATIVE_EVENT, listener);
}
