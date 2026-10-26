import { useQuery } from "@tanstack/react-query";
import type { Session } from "@/lib/db";
import { isAutoSessionName } from "@/lib/session-names";

type Titles = Record<string, string>;

async function fetchTitles(ids: string[]): Promise<Titles> {
  const res = await fetch(
    `/api/sessions/titles?ids=${encodeURIComponent(ids.join(","))}`
  );
  if (!res.ok) throw new Error("Failed to fetch session titles");
  return (await res.json()).titles ?? {};
}

/** Transcript titles for the given sessions, by id (Claude sessions only) */
export function useSessionTitles(sessionIds: string[]): Titles {
  // Sorted so the same set shares one cache entry
  const ids = [...new Set(sessionIds)].sort().slice(0, 100);
  const { data } = useQuery({
    queryKey: ["session-titles", ids],
    queryFn: () => fetchTitles(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  return data ?? {};
}

/** Titles for a whole list: only auto-named Claude sessions can get one */
export function useListTitles(
  sessions: Pick<Session, "id" | "name" | "agent_type">[]
): Titles {
  return useSessionTitles(
    sessions
      .filter(
        (s) =>
          (!s.agent_type || s.agent_type === "claude") &&
          isAutoSessionName(s.name)
      )
      .map((s) => s.id)
  );
}

/**
 * What a row shows: an auto name ("Session 24") steps aside for the
 * transcript's title and stays as the small id; a rename always wins.
 */
export function displayTitle(
  session: Pick<Session, "id" | "name">,
  titles: Titles
): { title: string; idLabel?: string } {
  const title = titles[session.id];
  if (title && title !== session.name && isAutoSessionName(session.name)) {
    return { title, idLabel: session.name };
  }
  return { title: session.name };
}
