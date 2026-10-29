"use client";

import { usePreference } from "@/data/preferences/queries";
import {
  FLAGS_PREFERENCE_KEY,
  parseFlags,
  type FlagName,
  type Flags,
} from "@/lib/flag-names";

/**
 * The stored flags, for behaviour decided in the browser (`chatDefault`).
 * Defaults (all off) until loaded. The server's own gates (queue,
 * snapshots) come back with their data instead: QueueState.enabled,
 * TurnsResponse.enabled
 */
export function useFlags(): Flags {
  const { data } = usePreference<Partial<Flags> | null>(
    FLAGS_PREFERENCE_KEY,
    null
  );
  return parseFlags(data);
}

export function useFlag(name: FlagName): boolean {
  return useFlags()[name];
}
