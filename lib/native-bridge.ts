/**
 * Talks to the native iOS app (ios/) when Agent-OS runs inside it.
 *
 * The app injects `window.agentosNative` before the page loads and owns the
 * navigation (the system's vertical bar on iPhone Duo) and the keyboard's
 * accessory keys. Native -> web arrives as `agentos-native` events; web ->
 * native goes through the `agentos` script message handler.
 */

import type { PaneViewMode } from "@/stores/mobileNav";
import type { Fold } from "@/stores/posture";

export type NativeNavAction =
  | "inbox"
  | "chat"
  | "terminal"
  | "git"
  | "files"
  | "find"
  | "new"
  | "sessions"
  | "settings";

export type NativeEvent =
  | { type: "nav"; action: NativeNavAction }
  /** A key from the keyboard's accessory bar, as terminal input */
  | { type: "key"; key: string }
  /** Text from the bar's system Paste button */
  | { type: "paste"; text: string }
  /** The bar's Add image button */
  | { type: "image" }
  | { type: "keyboard"; visible: boolean }
  /** The fold while half open, in the page's CSS pixels */
  | { type: "posture"; fold: Fold | null }
  /** Open a session: a tapped notification or an agentos://session/<id> link */
  | { type: "open"; sessionId: string }
  /** A file shared to the app ("Open in Agent-OS"), for the focused session */
  | { type: "file"; file: SharedFile };

export interface SharedFile {
  name: string;
  mimeType: string;
  base64: string;
}

export interface NativeState {
  type: "state";
  viewMode: PaneViewMode;
  waiting: number;
  changes: number;
  /** The page's background (getComputedStyle), for the edges the app shows around it */
  background?: string;
  /** The Settings page is showing (older app builds ignore it) */
  settings?: boolean;
}

export const NATIVE_EVENT = "agentos-native";

declare global {
  interface Window {
    agentosNative?: {
      platform: string;
      version: string;
      fold?: Fold | null;
      /** A session to open, set when a link launched the app */
      open?: string;
      /** A file shared to the app before the page was ready */
      file?: SharedFile;
    };
    webkit?: {
      messageHandlers?: Record<string, { postMessage: (msg: unknown) => void }>;
    };
  }
}

export function isNative(): boolean {
  return typeof window !== "undefined" && !!window.agentosNative;
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

/** Settings → Server: the app's own server and sign-in screen */
export interface NativeServer {
  type: "server";
}

export function postToNative(
  message: NativeState | NativeKeybar | NativeHaptic | NativeServer
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
