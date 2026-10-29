"use client";

import { GroupCard } from "@/components/a/GroupCard";
import { useLimitClock } from "@/hooks/useSessionLimit";
import { useProjectsQuery } from "@/data/projects";
import type { Session } from "@/lib/db";
import { LimitedCard, LimitedRow } from "./LimitedCard";
import { limitView } from "./limited-model";

/**
 * The usage-limit card in the needs-you card's place (N-Limited): the
 * three choices while none is made, then the "Will resume at …" or
 * snoozed row with Cancel. Nothing while the session isn't limited
 */
export function LimitedCardSlot({ session }: { session: Session }) {
  // Re-read as the reset passes, so the card goes on its own
  const now = useLimitClock([session.limited_until]);
  const view = limitView(session, now);
  const { data: projects } = useProjectsQuery();
  if (!view) return null;
  const project = projects?.find((p) => p.id === session.project_id);
  const projectName =
    project && !project.is_uncategorized ? project.name : undefined;

  if (view === "card")
    return (
      <LimitedCard
        session={session}
        projectName={projectName}
        title={session.name}
      />
    );
  return (
    <GroupCard aria-label="Limited">
      <LimitedRow session={session} title={session.name} view={view} />
    </GroupCard>
  );
}
