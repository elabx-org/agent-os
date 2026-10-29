"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { agentName } from "@/components/a/Avatar";
import { dbTimeMs } from "@/lib/agent-state";
import { StateDot } from "@/components/a/StateDot";
import { PermissionCard } from "@/components/Composer/PermissionCard";
import { useAnswerPrompt, useSessionPrompt } from "@/data/prompts/queries";
import { useClaudeState } from "@/hooks/useClaudeState";
import { useQueue } from "@/hooks/useQueue";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useReplyContextState } from "@/hooks/useReplyContext";
import { haptic } from "@/lib/haptics";
import {
  isAnswerableQuestion,
  shortLabel,
  splitOptions,
} from "@/lib/permission-card";
import { mobileNavStore } from "@/stores/mobileNav";
import type { Session } from "@/lib/db";
import type { PromptOption } from "@/lib/permission-prompt";
import { clockElapsed } from "./rows";

export interface NeedsYouCardProps {
  session: Session;
  /**
   * inline: in the conversation (Closed-Chat, Desk-Chat, "Claude is
   * asking"); sheet: the Live activity's "Waiting for your answer" with
   * how long it has waited (E-Live); rail: Desk-Chat's right rail, title only
   */
  variant: "inline" | "sheet" | "rail";
  onOpenTerminal?: () => void;
  onAnswered?: () => void;
  className?: string;
  /** No "Claude is asking" title: the fold deck's state line above says it */
  noHead?: boolean;
}

/** m:ss since `since`, ticking */
function Waited({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[13px] tabular-nums">
      {clockElapsed(now - since)}
    </span>
  );
}

/** The card's top line: amber dot and words, and on the sheet the time */
function Head({ text, since }: { text: string; since?: number | null }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <StateDot state="needs" />
      <span className="dark:text-needs min-w-0 truncate font-semibold text-amber-600">
        {text}
      </span>
      {since ? <Waited since={since} /> : null}
    </div>
  );
}

/**
 * The amber card for what the agent waits on: a question's options as
 * pills (primary first), or M0's PermissionCard for a permission. Renders
 * nothing when the session waits on nothing
 */
export function NeedsYouCard({
  session,
  variant,
  noHead,
  onOpenTerminal,
  onAnswered,
  className,
}: NeedsYouCardProps) {
  const { statuses } = useSnapshot(mobileNavStore);
  const status = statuses[session.id]?.status;
  const mode = useLayoutMode();
  const name = agentName(session.agent_type);
  const claude = (session.agent_type || "claude") === "claude";
  const live = status === "waiting" || status === "running";
  const hook = useClaudeState(claude ? session.id : null, live);
  // Its hook knows of a permission request before the screen poll does. A
  // denied request leaves no hook event behind, so it only counts while the
  // session isn't idle
  const pending = live ? hook.pendingPermission : null;
  const needsYou = status === "waiting" || !!pending;

  const { data: prompt, isLoading: promptLoading } = useSessionPrompt(
    session.id,
    { enabled: needsYou && variant !== "rail" }
  );
  const { answer, answering, error } = useAnswerPrompt(session.id);
  // With the server queue on, the composer's text waits for the answer
  // instead of typing into the question: a typed reply is the terminal's
  const queued = useQueue(session.id, {
    enabled: needsYou && variant === "inline",
  }).enabled;
  // Classified as the server's guard does: unclear means permission
  const { context, loading: contextLoading } = useReplyContextState(
    session.id,
    !!prompt && variant !== "rail"
  );
  const question =
    !!prompt && !contextLoading && isAnswerableQuestion(context, prompt);
  const permission =
    prompt && !contextLoading && !question
      ? { tool: pending, prompt }
      : !prompt && !promptLoading && pending
        ? { tool: pending, prompt: null }
        : null;

  // How long it has waited: the hook's time, else the session's last
  // change on the server, else since this card saw it
  const [seen, setSeen] = useState<number | null>(null);
  const changedAt = session.updated_at ? dbTimeMs(session.updated_at) : NaN;
  useEffect(() => {
    setSeen(
      needsYou
        ? Number.isNaN(changedAt)
          ? Date.now()
          : Math.min(changedAt, Date.now())
        : null
    );
  }, [needsYou, changedAt]);
  const since = pending?.at ?? hook.notification?.at ?? seen;

  if (!needsYou) return null;

  if (variant === "rail") {
    return (
      <div
        className={cn(
          "status-card tone-needs h-auto min-h-11 gap-2.5 px-3.5 py-2.5 text-[15px]",
          className
        )}
      >
        <StateDot state="needs" />
        <span className="min-w-0 flex-1 truncate">Waiting for your answer</span>
      </div>
    );
  }

  const sheet = variant === "sheet";
  const desktop = mode === "desktop";
  // A finished turn or a typed-reply wait has nothing to answer inline
  if (!sheet && !question && !permission) return null;

  const choose = async (option: PromptOption) => {
    if (!(await answer(option))) return;
    haptic("success");
    onAnswered?.();
  };
  const split = question && prompt ? splitOptions(prompt.options) : null;
  const ask = prompt?.question || context?.question || prompt?.title;

  return (
    <div className={cn("ask-card", sheet && "bg-[var(--block)]", className)}>
      {!noHead && (
        <Head
          text={
            sheet
              ? "Waiting for your answer"
              : permission
                ? pending
                  ? `${name} wants to use ${pending.tool_name}`
                  : `${name} needs permission`
                : `${name} is asking`
          }
          since={sheet ? since : null}
        />
      )}

      {sheet && promptLoading && (
        <div className="text-muted-foreground flex items-center gap-2 text-[13px]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the session…
        </div>
      )}
      {sheet && !promptLoading && !question && !permission && (
        <p className="text-foreground/75 text-sm">
          {name} needs a typed reply.
        </p>
      )}

      {permission && (
        <PermissionCard
          session={session}
          permission={permission}
          onAnswered={onAnswered}
          onOpen={onOpenTerminal}
        />
      )}

      {question && split && (
        <>
          {/* The sheet shows the answers alone, under its title */}
          {!sheet && ask && (
            <p className="text-[16px] leading-snug font-medium">{ask}</p>
          )}
          <div className="flex items-center gap-2.5">
            {split.main.map((option, i) => (
              <button
                key={`${option.index}-${option.label}`}
                type="button"
                title={option.label}
                disabled={answering !== null}
                onClick={() => choose(option)}
                className={cn(
                  "pill min-w-0 touch-manipulation disabled:opacity-60",
                  !desktop && "flex-1",
                  // The first answer is the one that lets it go on
                  i === 0
                    ? "pill-primary active:opacity-80"
                    : "pill-secondary active:opacity-80"
                )}
              >
                {answering === option.index && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                )}
                <span className="truncate">{shortLabel(option)}</span>
              </button>
            ))}
            {desktop && !sheet && !queued && (
              <span className="text-muted-foreground ml-auto shrink-0 text-[13px]">
                or type a reply
              </span>
            )}
            {desktop && !sheet && queued && onOpenTerminal && (
              <button
                type="button"
                onClick={onOpenTerminal}
                className="text-muted-foreground relative ml-auto shrink-0 text-[13px] after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:underline"
              >
                or type a reply in the terminal
              </button>
            )}
          </div>
          {split.more && onOpenTerminal && (
            <button
              type="button"
              onClick={onOpenTerminal}
              className="text-muted-foreground relative -my-0.5 self-start py-1 text-xs after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-['']"
            >
              More…
            </button>
          )}
        </>
      )}

      {error && <p className="text-xs text-[var(--del)]">{error}</p>}
    </div>
  );
}
