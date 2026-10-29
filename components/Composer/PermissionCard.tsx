"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Loader2, Lock, ShieldOff, SquareTerminal } from "lucide-react";
import { confirmAction } from "@/components/ui/confirm";
import { useAnswerPrompt } from "@/data/prompts/queries";
import { useAgentActions } from "@/hooks/useAgentActions";
import { usePermissionMode } from "@/hooks/usePermissionMode";
import { timeAgo } from "@/lib/agent-state";
import { haptic } from "@/lib/haptics";
import {
  blockedText,
  fullAccessNote,
  KIND_STYLE,
  latestBlocked,
  shortLabel,
  splitOptions,
  toolSummary,
} from "@/lib/permission-card";
import { restartSession } from "@/lib/restart-session";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";
import type { ClaudeTool } from "@/lib/claude-state";
import type { PermissionPrompt, PromptOption } from "@/lib/permission-prompt";

/**
 * A permission request waiting for the user: from Claude's hook state
 * (chat) and/or the prompt on screen (inbox); at least one is set.
 */
export interface PendingPermission {
  tool: ClaudeTool | null;
  prompt: PermissionPrompt | null;
}

export interface PermissionCardProps {
  session: Session;
  permission: PendingPermission;
  onAnswered?: () => void;
  /** As the Inbox card's variants; "full" by default */
  variant?: "full" | "card" | "page";
  /**
   * Opens the session: "More…" on the compact card, and "Answer in
   * terminal" when only the hook saw the request (nothing to answer here)
   */
  onOpen?: () => void;
}

// Without the hook's time, attempts this recent count as on this request
const LOOKBACK_MS = 10 * 60_000;
// An agent can try in the moment before the hook writes the request
const HOOK_SLACK_MS = 5_000;

const ANSWER =
  "flex min-h-[44px] min-w-0 touch-manipulation items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold disabled:opacity-60";
// Small to look at, the size of a finger to press
const LINK =
  "relative inline-flex min-h-6 items-center gap-1.5 text-xs font-medium after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-[''] active:opacity-70";

/**
 * Allow / Deny / Switch to full access, the lock note and blocked attempts.
 * The answers are the user's alone: agents are refused by the server, and
 * what they tried shows under the buttons.
 */
export function PermissionCard({
  session,
  permission,
  onAnswered,
  variant = "full",
  onOpen,
}: PermissionCardProps) {
  const { tool, prompt } = permission;
  const card = variant === "card";
  const { answer, answering, error } = useAnswerPrompt(session.id);

  const [lookback] = useState(() => Date.now() - LOOKBACK_MS);
  const since = tool?.at ? tool.at - HOOK_SLACK_MS : lookback;
  const { actions } = useAgentActions(session.id, { since });
  const blocked = latestBlocked(actions, since);

  const mode = usePermissionMode(session.id);
  const claude = (session.agent_type || "claude") === "claude";
  const [switched, setSwitched] = useState<ReturnType<
    typeof fullAccessNote
  > | null>(null);
  const note =
    switched ??
    (mode.state?.pending === "bypassPermissions"
      ? fullAccessNote({ appliedNow: false, needsRestart: true }, claude)
      : null);
  const canSwitch = !note && mode.state?.mode !== "bypassPermissions";

  const choose = async (option: PromptOption) => {
    if (option.kind === "allow" || option.kind === "always") haptic("success");
    await answer(option);
    onAnswered?.();
  };

  const switchToFullAccess = async () => {
    // The confirm's destructive button gives the warning haptic
    const ok = await confirmAction({
      title: `Switch ${session.name} to full access?`,
      message: "It will never ask, even to delete files.",
      confirmLabel: "Switch to full access",
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await mode.setMode({
        mode: "bypassPermissions",
        allowPending: true,
      });
      const next = fullAccessNote(result, claude);
      setSwitched(next);
      // The card goes with the answered request, so the toast carries it
      toast(`${session.name}: ${next.text}`, {
        action: next.restart
          ? { label: "Restart now", onClick: () => restartSession(session) }
          : undefined,
      });
      onAnswered?.();
    } catch {
      // mode.error says why
    }
  };

  const split = prompt ? splitOptions(prompt.options) : null;
  // The full card lists the rest under the main row ("Yes, and don't ask
  // again for…"); the compact one has More…
  const rest =
    prompt && split && !card
      ? prompt.options.filter((o) => !split.main.includes(o))
      : [];
  const summary = tool ? toolSummary(tool) : "";
  const busy = answering !== null || mode.setting;

  const answerButton = (option: PromptOption, wide: boolean) => (
    <button
      key={`${option.index}-${option.label}`}
      type="button"
      title={option.label}
      disabled={busy}
      onClick={() => choose(option)}
      className={cn(
        ANSWER,
        wide ? "w-full text-left" : "flex-1 justify-center",
        KIND_STYLE[option.kind],
        variant === "page" && option.kind === "deny" && "text-red-400"
      )}
    >
      {answering === option.index && (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      )}
      <span className={wide ? "line-clamp-2" : "truncate"}>
        {wide ? option.label : shortLabel(option)}
      </span>
    </button>
  );

  return (
    <div className="@container grid gap-2.5">
      {!card && prompt?.description && (
        <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-line">
          {prompt.description}
        </p>
      )}
      {prompt?.detail ? (
        <pre
          className={cn(
            "bg-background font-mono text-xs whitespace-pre-wrap",
            card
              ? "border-border line-clamp-3 rounded-[9px] border px-2.5 py-2 break-all"
              : "max-h-40 overflow-auto rounded-lg px-3 py-2 leading-relaxed"
          )}
        >
          {prompt.detail}
        </pre>
      ) : (
        summary && (
          <p className="bg-background truncate rounded-lg px-3 py-2 font-mono text-xs">
            {summary}
          </p>
        )
      )}
      {prompt?.question && !(card && prompt.detail) && (
        <p className={cn("text-sm", card ? "line-clamp-2" : "font-medium")}>
          {prompt.question}
        </p>
      )}

      <p className="bg-foreground/[0.04] text-muted-foreground flex items-start gap-2 rounded-xl px-2.5 py-2 text-[13px] leading-snug">
        <Lock className="mt-px h-4 w-4 shrink-0 text-amber-400" />
        {card
          ? "Only you can allow this."
          : "Only you can allow this. Agents can answer questions, not permission requests."}
      </p>

      {prompt && split ? (
        <>
          <div className="flex gap-2 @max-[380px]:flex-col">
            {split.main.map((option) => answerButton(option, false))}
          </div>
          {rest.length > 0 && (
            <div className="flex flex-col gap-2">
              {rest.map((option) => answerButton(option, true))}
            </div>
          )}
        </>
      ) : (
        onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className={cn(ANSWER, "border-border justify-center border")}
          >
            <SquareTerminal className="h-4 w-4" />
            Answer in terminal
          </button>
        )
      )}

      {(canSwitch || (card && split?.more && onOpen)) && (
        <div className="flex items-center gap-4 px-0.5">
          {canSwitch && (
            <button
              type="button"
              disabled={busy}
              onClick={switchToFullAccess}
              className={cn(
                LINK,
                "text-red-600 disabled:opacity-60 dark:text-red-400"
              )}
            >
              {mode.setting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" />
              )}
              Switch to full access
            </button>
          )}
          {card && split?.more && onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className={cn(LINK, "text-muted-foreground ml-auto")}
            >
              More…
            </button>
          )}
        </div>
      )}

      {note && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 px-0.5 text-xs">
          <ShieldOff className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
          {note.text}
          {note.restart && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => restartSession(session)}
                className={cn(LINK, "text-foreground")}
              >
                Restart now
              </button>
            </>
          )}
        </p>
      )}

      {blocked && (
        <p className="text-muted-foreground/80 flex items-start gap-1.5 px-0.5 text-xs leading-snug">
          <Ban className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {blockedText(blocked)} · {timeAgo(blocked.at)}
          </span>
        </p>
      )}

      {(error || mode.error) && (
        <p className="text-xs text-red-400">{error ?? mode.error}</p>
      )}
    </div>
  );
}
