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
  | "sessions";

export type NativeEvent =
  | { type: "nav"; action: NativeNavAction }
  /** A key from the keyboard's accessory bar, as terminal input */
  | { type: "key"; key: string }
  | { type: "keyboard"; visible: boolean }
  /** The fold while half open, in the page's CSS pixels */
  | { type: "posture"; fold: Fold | null };

export interface NativeState {
  type: "state";
  viewMode: PaneViewMode;
  waiting: number;
  changes: number;
}

export const NATIVE_EVENT = "agentos-native";

declare global {
  interface Window {
    agentosNative?: { platform: string; version: string; fold?: Fold | null };
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

export function postToNative(message: NativeState): void {
  window.webkit?.messageHandlers?.agentos?.postMessage(message);
}

export function onNativeEvent(
  handler: (event: NativeEvent) => void
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<NativeEvent>).detail);
  window.addEventListener(NATIVE_EVENT, listener);
  return () => window.removeEventListener(NATIVE_EVENT, listener);
}
