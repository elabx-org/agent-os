"use client";

import { useQuery } from "@tanstack/react-query";
import type { MachineSetup } from "@/lib/claude-setup/hub";
import { countSentence } from "@/lib/claude-setup/types";
import { HUB_TARGET } from "@/lib/machine-marker";

export interface SetupGap {
  /** What "copy them first" sends: missing or outdated, never left out */
  keys: string[];
  /** "11 skills and 14 plugins" */
  sentence: string;
}

/**
 * What a linked machine lacks of this server's skills and plugins
 * (lib/claude-setup), for a chat about to move there from the server.
 * Null while unknown, when nothing is missing, or the other way round
 */
export function useSetupGap(
  from: string,
  to: string | undefined
): SetupGap | null {
  const enabled = from === HUB_TARGET && !!to && to !== HUB_TARGET;
  const { data } = useQuery({
    queryKey: ["claude-setup", to],
    queryFn: async () => {
      const res = await fetch(`/api/machines/${to}/claude-setup`);
      if (!res.ok) throw new Error("unavailable");
      return (await res.json()) as MachineSetup;
    },
    enabled,
    staleTime: 5000,
    retry: false,
  });
  if (!enabled || !data?.claude) return null;
  const skip = new Set(data.skip);
  const rows = data.rows.filter(
    (row) =>
      (row.state === "missing" || row.state === "update") &&
      !skip.has(row.item.key) &&
      !row.item.usesTools
  );
  if (!rows.length) return null;
  return {
    keys: rows.map((row) => row.item.key),
    sentence: countSentence(rows.map((row) => row.item)),
  };
}

/** Copies them; an error message when it couldn't */
export async function copySetupGap(
  to: string,
  gap: SetupGap,
  send: (input: string, init: RequestInit) => Promise<Response>
): Promise<string | null> {
  try {
    const res = await send(`/api/machines/${to}/claude-setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: gap.keys }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? "It stopped with an error";
  } catch {
    return "The other machine couldn't be reached";
  }
}
