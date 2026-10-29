"use client";

import { DEFAULT_LOOK, type Look } from "@/lib/look";

/**
 * The look with its setter. Synced (the default), the server's `look`
 * preference is applied on load and every change is saved there, so all
 * devices follow; unsynced, it stays on this device. Mounted once in
 * Providers (which applies it); Display calls it to read and change it.
 */
export function useSyncedLook(): {
  look: Look;
  setLook: (patch: Partial<Look>) => void;
} {
  // Contract stub: U1.4
  return { look: DEFAULT_LOOK, setLook: () => {} };
}
