"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { usePreference } from "@/data/preferences/queries";
import { preferencesKeys } from "@/data/preferences/keys";
import { fetchAsUser } from "@/lib/client/user-fetch";
import {
  FLAG_LABELS,
  FLAG_NAMES,
  FLAGS_PREFERENCE_KEY,
  parseFlags,
  type FlagName,
  type Flags,
} from "@/lib/flag-names";
import { SettingGroup, SettingRow } from "./SettingGroup";

/**
 * Kill switches for background work and new behaviour (lib/flags.ts), hidden
 * behind a long press on the version line. A change applies within 5s, with
 * no deploy. Servers started with AGENTOS_DISABLE_TICKERS keep tickers off
 * whatever this says.
 */
export function LabsSection() {
  const queryClient = useQueryClient();
  const { data: stored } = usePreference<Partial<Flags> | null>(
    FLAGS_PREFERENCE_KEY,
    null
  );
  const flags = parseFlags(stored);
  const [saving, setSaving] = useState<FlagName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (name: FlagName, on: boolean) => {
    const key = preferencesKeys.detail(FLAGS_PREFERENCE_KEY);
    const previous = queryClient.getQueryData(key);
    const next: Flags = { ...flags, [name]: on };
    queryClient.setQueryData(key, next);
    setSaving(name);
    setError(null);
    try {
      // User-only: an agent must not turn on instant full access
      const res = await fetchAsUser("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: FLAGS_PREFERENCE_KEY, value: next }),
      });
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? "Reload to confirm it's you"
            : "Couldn't save the change"
        );
      }
    } catch (e) {
      queryClient.setQueryData(key, previous);
      setError(e instanceof Error ? e.message : "Couldn't save the change");
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <SettingGroup>
        {FLAG_NAMES.map((name) => (
          <SettingRow
            key={name}
            label={FLAG_LABELS[name].label}
            hint={FLAG_LABELS[name].hint}
          >
            <Switch
              checked={flags[name]}
              disabled={saving !== null}
              onCheckedChange={(on) => toggle(name, on)}
            />
          </SettingRow>
        ))}
      </SettingGroup>
      {error && <p className="px-5 pt-1 text-xs text-red-500">{error}</p>}
    </>
  );
}
