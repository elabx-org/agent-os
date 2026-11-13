import { useCallback, useEffect } from "react";
import { usePreference, useUpdatePreference } from "./preferences/queries";
import {
  DEFAULT_SNIPPETS,
  SNIPPETS_PREFERENCE_KEY,
  SNIPPETS_STORAGE_KEY,
  SNIPPETS_SYNCED_KEY,
  asSnippets,
  reconcile,
  type Snippet,
} from "@/lib/snippets";

function localSnippets(): Snippet[] | null {
  try {
    const stored = localStorage.getItem(SNIPPETS_STORAGE_KEY);
    return stored ? asSnippets(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

function synced(): boolean {
  try {
    return localStorage.getItem(SNIPPETS_SYNCED_KEY) === "1";
  } catch {
    return true;
  }
}

/** The shared snippets, and `save` to replace the list */
export function useSnippets() {
  const { data, isSuccess } = usePreference<unknown>(
    SNIPPETS_PREFERENCE_KEY,
    null
  );
  const { mutate } = useUpdatePreference();
  const server = isSuccess ? asSnippets(data) : null;

  const save = useCallback(
    (snippets: Snippet[]) =>
      mutate({ key: SNIPPETS_PREFERENCE_KEY, value: snippets }),
    [mutate]
  );

  // Once per browser: hand its own list over
  useEffect(() => {
    if (!isSuccess) return;
    const next = reconcile(asSnippets(data), localSnippets(), synced());
    if (next) save(next);
    try {
      localStorage.setItem(SNIPPETS_SYNCED_KEY, "1");
    } catch {
      // Private mode: it asks again next time, and finds nothing to add
    }
  }, [isSuccess, data, save]);

  return {
    // Until the server answers: what this browser had
    snippets: server ?? localSnippets() ?? DEFAULT_SNIPPETS,
    save,
  };
}
