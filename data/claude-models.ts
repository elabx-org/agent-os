"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePreference } from "@/data/preferences/queries";
import { preferencesKeys } from "@/data/preferences/keys";
import { fetchAsUser } from "@/lib/client/user-fetch";
import {
  CLAUDE_MODELS_PREFERENCE_KEY,
  parseClaudeModels,
  type ClaudeModels,
} from "@/lib/claude-models";

/**
 * Settings → Claude Code's models for new sessions (lib/claude-models.ts),
 * shared by every device; saving is the user's own (an agent can't)
 */
export function useClaudeModels() {
  const queryClient = useQueryClient();
  const { data: stored, isLoading } = usePreference<unknown>(
    CLAUDE_MODELS_PREFERENCE_KEY,
    null
  );
  const models = parseClaudeModels(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<ClaudeModels>) => {
    const key = preferencesKeys.detail(CLAUDE_MODELS_PREFERENCE_KEY);
    const previous = queryClient.getQueryData(key);
    const next: ClaudeModels = { ...models, ...patch };
    queryClient.setQueryData(key, next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetchAsUser("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: CLAUDE_MODELS_PREFERENCE_KEY,
          value: next,
        }),
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
      setSaving(false);
    }
  };

  return { models, loaded: !isLoading, save, saving, error };
}
