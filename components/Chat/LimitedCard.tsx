"use client";

import { Clock, Hourglass, Loader2 } from "lucide-react";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { haptic } from "@/lib/haptics";
import { LIMIT_TEXT_CLASS } from "@/lib/agent-state";
import { useLimitClock, useSessionLimit } from "@/hooks/useSessionLimit";
import { useFlag } from "@/hooks/useFlags";
import type { ResumeWhen } from "@/lib/limits/types";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  limitLine,
  resetIn,
  scheduledLine,
  snoozedLine,
  type LimitView,
} from "./limited-model";

/** The card's "in 1h 12m" moves on by the minute */
const CLOCK_MS = 30_000;

export interface LimitedProps {
  session: Session;
  projectName?: string;
  /** The session's title as its lists show it */
  title: string;
  /** Its title opens it (Now); in its own chat there's nothing to open */
  onOpen?: () => void;
  className?: string;
  /** Where it is drawn (data-limited, for tests): "chat" or Now's "now" */
  place?: "chat" | "now";
}

const ACTIONS: { when: ResumeWhen; label: string; primary?: boolean }[] = [
  { when: "reset", label: "Resume at reset", primary: true },
  { when: "now", label: "Resume now" },
  { when: "snooze", label: "Snooze" },
];

/**
 * A session stopped at a usage limit, no choice made yet (N-Limited): the
 * hourglass and "Limited", what it hit and when it resets, then Resume at
 * reset / Resume now / Snooze. Shared by Now and the chat
 */
export function LimitedCard({
  session,
  projectName,
  title,
  onOpen,
  className,
  place = "now",
}: LimitedProps) {
  const { state, resume, pending, error } = useSessionLimit(session);
  const now = useLimitClock([state.limitedUntil], CLOCK_MS);
  // Nothing types a scheduled resume while auto-resume is off
  const autoResume = useFlag("autoResume");
  const actions = autoResume
    ? ACTIONS
    : ACTIONS.filter((a) => a.when !== "reset");
  const name = agentName(session.agent_type);
  const left = resetIn(state.limitedUntil, now);

  const choose = (when: ResumeWhen) => {
    resume(when).then(
      () => haptic("success"),
      // useSessionLimit shows the error
      () => {}
    );
  };

  return (
    <div
      role="group"
      data-limited={place}
      aria-label={`${title}: limited`}
      className={cn(
        "bg-card flex flex-col gap-1.5 rounded-[22px] border px-3.5 py-3",
        "border-[rgba(91,84,153,0.28)] dark:border-[rgba(165,160,210,0.30)]",
        className
      )}
    >
      <span className="text-muted-foreground flex w-full min-w-0 items-center gap-2 text-[13px]">
        <Hourglass
          aria-hidden
          className={cn("h-4 w-4 flex-none", LIMIT_TEXT_CLASS)}
        />
        <span className={cn("font-semibold", LIMIT_TEXT_CLASS)}>Limited</span>
        <span className="min-w-0 flex-1 truncate">
          · {[projectName, name].filter(Boolean).join(" · ")}
        </span>
        {left && <span className="shrink-0 tabular-nums">{left}</span>}
      </span>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="t-head w-full truncate text-left active:opacity-70"
        >
          {title}
        </button>
      ) : (
        <span className="t-head w-full truncate">{title}</span>
      )}
      <span className="text-foreground/75">{limitLine(state, name, now)}</span>
      {/* px, not rem (the root is 15px), and under the mock's padding: the
          app's Inter sets a little wider than the mock's, and the three
          labels stay whole in the closed chat, the narrowest place */}
      <div className="mt-1 flex items-center gap-[4px]">
        {actions.map(({ when, label, primary }) => (
          <button
            key={when}
            type="button"
            disabled={pending}
            onClick={() => choose(when)}
            className={cn(
              "pill pill-sm h-[44px] min-w-0 touch-manipulation rounded-[22px] whitespace-nowrap active:opacity-80 disabled:opacity-60",
              primary
                ? "pill-primary flex-[1_1_auto] px-[6px]"
                : "pill-secondary flex-[0_1_auto] px-[7px]"
            )}
          >
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-[var(--del)]">{error}</p>}
    </div>
  );
}

/**
 * A limit with its choice made, as a row: "Will resume at 3:40 pm" with a
 * clock (at_reset), or "Snoozed · resets 3:40 pm" (snooze); Cancel takes
 * the choice back. Goes inside a GroupCard
 */
export function LimitedRow({
  session,
  title,
  onOpen,
  view,
}: LimitedProps & { view: Exclude<LimitView, "card"> }) {
  const { state, cancel, pending, error } = useSessionLimit(session);
  const now = useLimitClock([state.limitedUntil], CLOCK_MS);
  const scheduled = view === "scheduled";
  const body = (
    <>
      <Avatar {...agentAvatar(session.agent_type)} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[16px] font-medium">{title}</span>
        <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-[14px]">
          {scheduled && (
            <Clock
              aria-hidden
              className={cn("h-3.5 w-3.5 flex-none", LIMIT_TEXT_CLASS)}
            />
          )}
          <span className="truncate">
            {error ??
              (scheduled ? scheduledLine(state, now) : snoozedLine(state, now))}
          </span>
        </span>
      </span>
    </>
  );
  return (
    <div className="row w-full">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="-my-3 flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 active:opacity-70"
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => cancel().catch(() => {})}
        aria-label={scheduled ? "Cancel scheduled resume" : "Cancel snooze"}
        className="pill pill-secondary shrink-0 touch-manipulation px-4 active:opacity-80 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Cancel
      </button>
    </div>
  );
}
