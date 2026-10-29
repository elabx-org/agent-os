"use client";

import { useCallback, useEffect } from "react";
import { useTheme } from "next-themes";
import { proxy, useSnapshot } from "valtio";
import { useQuery } from "@tanstack/react-query";
import { preferencesKeys, useUpdatePreference } from "@/data/preferences";
import {
  DEFAULT_LOOK,
  LOOK_PREFERENCE_KEY,
  applyAccent,
  readAccent,
  type Look,
} from "@/lib/look";
import {
  LOOK_SYNCED_STORAGE_KEY,
  lookDiffers,
  mergeLook,
  modeFromTheme,
  readSynced,
} from "@/lib/look-sync";
import {
  DENSITY_EVENT,
  getDisplayClass,
  getOffset,
  setOffset,
} from "@/lib/display-density";

/** This device's accent, text size and sync choice, shared by every caller */
const deviceLook = proxy({
  loaded: false,
  accent: DEFAULT_LOOK.accent,
  textSize: DEFAULT_LOOK.textSize,
  synced: DEFAULT_LOOK.synced,
});

/** The server's look is applied once per page load, by whichever caller
    has it first */
let serverLookApplied = false;

function loadDeviceLook() {
  if (deviceLook.loaded) return;
  deviceLook.loaded = true;
  deviceLook.accent = readAccent();
  deviceLook.textSize = getOffset(getDisplayClass());
  try {
    deviceLook.synced = readSynced(
      localStorage.getItem(LOOK_SYNCED_STORAGE_KEY)
    );
  } catch {
    // Storage blocked: synced, the default
  }
}

async function fetchLook(): Promise<unknown> {
  const res = await fetch(
    `/api/preferences?key=${encodeURIComponent(LOOK_PREFERENCE_KEY)}`
  );
  if (!res.ok) throw new Error("Failed to fetch the look");
  return (await res.json()).value;
}

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
  const { theme, setTheme } = useTheme();
  const device = useSnapshot(deviceLook);
  const { mutate: save } = useUpdatePreference();

  useEffect(() => {
    loadDeviceLook();
    // A− / A+ elsewhere, or another display class after a resize or unfold
    const update = () => {
      deviceLook.textSize = getOffset(getDisplayClass());
    };
    window.addEventListener(DENSITY_EVENT, update);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener(DENSITY_EVENT, update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const look: Look = {
    mode: modeFromTheme(theme),
    accent: device.accent,
    textSize: device.textSize,
    synced: device.synced,
  };

  const { data: server, isSuccess } = useQuery({
    queryKey: preferencesKeys.detail(LOOK_PREFERENCE_KEY),
    queryFn: fetchLook,
    staleTime: Infinity,
    enabled: device.loaded && device.synced,
  });

  const apply = useCallback(
    (next: Look) => {
      setTheme(next.mode);
      applyAccent(next.accent);
      deviceLook.accent = next.accent;
      setOffset(getDisplayClass(), next.textSize);
    },
    [setTheme]
  );

  // Synced: the server's look wins once on load; with none there yet, this
  // device's becomes it
  useEffect(() => {
    if (!isSuccess || !device.loaded || !device.synced || serverLookApplied)
      return;
    serverLookApplied = true;
    const merged = mergeLook(look, server, true);
    if (server === null || server === undefined) {
      save({ key: LOOK_PREFERENCE_KEY, value: merged });
    } else if (lookDiffers(look, merged)) {
      apply(merged);
    }
    // Once, when the server's answer is in: later look changes don't re-run it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, server, device.loaded, device.synced]);

  const setLook = useCallback(
    (patch: Partial<Look>) => {
      const current: Look = {
        mode: modeFromTheme(theme),
        accent: deviceLook.accent,
        textSize: deviceLook.textSize,
        synced: deviceLook.synced,
      };
      const next: Look = { ...current, ...patch };
      if (patch.mode !== undefined) setTheme(patch.mode);
      if (patch.accent !== undefined) {
        applyAccent(patch.accent);
        deviceLook.accent = patch.accent;
      }
      if (patch.textSize !== undefined) {
        setOffset(getDisplayClass(), patch.textSize);
      }
      if (patch.synced !== undefined) {
        deviceLook.synced = patch.synced;
        try {
          localStorage.setItem(
            LOOK_SYNCED_STORAGE_KEY,
            patch.synced ? "1" : "0"
          );
        } catch {
          // Storage blocked: the choice lasts for this page load
        }
        // Turned on here: this device's look is the one the others follow
        if (patch.synced) serverLookApplied = true;
      }
      if (next.synced) {
        save({
          key: LOOK_PREFERENCE_KEY,
          value: { ...next, textSize: getOffset(getDisplayClass()) },
        });
      }
    },
    [theme, setTheme, save]
  );

  return { look, setLook };
}
