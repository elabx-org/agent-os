"use client";

import type { ReactNode } from "react";
import { Loader2, SquareTerminal, Users } from "lucide-react";
import { agentName } from "@/components/a/Avatar";
import { StateDot } from "@/components/a/StateDot";
import { PermissionCard } from "@/components/Composer/PermissionCard";
import { shortAge } from "@/components/MissionControl/now-summary";
import { useAnswerPrompt, useSessionPrompt } from "@/data/prompts/queries";
import { useReplyContextState } from "@/hooks/useReplyContext";
import { STATE_TEXT_CLASS } from "@/lib/agent-state";
import {
  isAnswerableQuestion,
  KIND_STYLE,
  shortLabel,
  splitOptions,
} from "@/lib/permission-card";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";

/** On a question: the guard lets agents answer it, so say so */
function AgentsCanAnswer() {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-primary/10 text-primary inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap">
        <Users className="h-3.5 w-3.5" />
        Agents can answer this
      </span>
      <span className="text-muted-foreground truncate text-xs">or you</span>
    </div>
  );
}

// The answer helpers live with the permission card; kept importable here
export { KIND_STYLE, shortLabel, splitOptions };

// "Bash command" reads as what Claude wants: "wants to run Bash"
export function askLabel(title: string): string {
  const command = /^(\w+) command$/i.exec(title);
  return command ? `wants to run ${command[1]}` : title;
}

export function InboxItem({
  session,
  projectName,
  onOpen,
  questionsOnly,
  variant = "full",
  title,
  as: Root = "li",
}: {
  session: Session;
  projectName?: string;
  onOpen: () => void;
  /** Render nothing unless Claude is asking a question (inline in Chat) */
  questionsOnly?: boolean;
  /**
   * "card": the home's compact prompt with one row of answers. "page": the
   * body alone, under a header of the page's own
   */
  variant?: "full" | "card" | "page";
  /** Display title; defaults to the session name */
  title?: ReactNode;
  /** "div" when it isn't inside a list */
  as?: "li" | "div";
}) {
  const { data: prompt, isLoading: promptLoading } = useSessionPrompt(
    session.id
  );
  const { answer, answering, error } = useAnswerPrompt(session.id);
  // Classified as the server's guard does: unclear means permission. Until
  // the context is in, it's neither card (not a permission card that turns
  // into a question)
  const { context, loading: contextLoading } = useReplyContextState(
    session.id,
    !!prompt
  );
  const isLoading = promptLoading || (!!prompt && contextLoading);
  const question =
    !!prompt && !contextLoading && isAnswerableQuestion(context, prompt);
  const permission =
    prompt && !contextLoading && !question ? { tool: null, prompt } : null;

  if (questionsOnly && !prompt) return null;

  if (variant === "card") {
    const split = prompt ? splitOptions(prompt.options) : null;
    const word = question
      ? "Asking"
      : permission
        ? "Permission"
        : isLoading
          ? "Needs you"
          : "Your turn";
    const name = title ?? session.name;
    return (
      // The mocks' .ask card
      <Root className="bg-card border-needs/40 flex flex-col gap-1.5 rounded-[22px] border p-3.5">
        <button
          type="button"
          onClick={onOpen}
          className="text-muted-foreground flex min-w-0 items-center gap-2 text-left text-[13px]"
        >
          <StateDot state="needs" />
          <span className={cn("font-semibold", STATE_TEXT_CLASS.needs)}>
            {word}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {/* A permission card has no title line: the header names it */}
            {"· " +
              [projectName, permission ? name : agentName(session.agent_type)]
                .filter(Boolean)
                .join(" · ")}
          </span>
          <span className="shrink-0">{shortAge(session.updated_at)}</span>
        </button>
        {!permission && (
          <button
            type="button"
            onClick={onOpen}
            className="t-head min-w-0 truncate text-left"
          >
            {name}
          </button>
        )}

        {isLoading && (
          <div className="text-muted-foreground flex items-center gap-2 text-[13px]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the
            session…
          </div>
        )}

        {!isLoading && !prompt && (
          <p className="text-foreground/75">
            Needs a typed reply. Open the session to respond.
          </p>
        )}

        {permission && (
          <div className="mt-0.5">
            <PermissionCard
              session={session}
              permission={permission}
              variant="card"
              onOpen={onOpen}
            />
          </div>
        )}

        {question && split && (
          <>
            {prompt.detail ? (
              <pre className="bg-background border-border line-clamp-3 rounded-[9px] border px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
                {prompt.detail}
              </pre>
            ) : (
              prompt.question && (
                <p className="text-foreground/75 line-clamp-2">
                  {prompt.question}
                </p>
              )
            )}
            <AgentsCanAnswer />
            <div className="mt-1.5 flex gap-2.5">
              {split.main.map((option, i) => (
                <button
                  key={`${option.index}-${option.label}`}
                  type="button"
                  title={option.label}
                  disabled={answering !== null}
                  onClick={() => answer(option)}
                  className={cn(
                    "pill min-w-0 flex-1 touch-manipulation px-3 disabled:opacity-60",
                    // The first answer is the one that lets it go on
                    i === 0
                      ? "pill-primary active:opacity-80"
                      : "border-foreground/10 bg-foreground/[0.06] active:bg-accent border font-medium"
                  )}
                >
                  {answering === option.index && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  )}
                  <span className="truncate">{shortLabel(option)}</span>
                </button>
              ))}
            </div>
            {split.more && (
              <button
                type="button"
                onClick={onOpen}
                className="text-muted-foreground relative -my-0.5 self-start py-1 text-xs after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-['']"
              >
                More…
              </button>
            )}
          </>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </Root>
    );
  }

  const page = variant === "page";
  return (
    <Root
      className={cn(
        "space-y-3",
        !page &&
          "rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-3.5"
      )}
    >
      {!page && (
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-4 ring-amber-400/20"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {title ?? session.name}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {[projectName, prompt ? askLabel(prompt.title) : "Your turn"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="text-muted-foreground active:bg-accent hover:bg-accent flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
          >
            <SquareTerminal className="h-4 w-4" />
            Open
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the session…
        </div>
      )}

      {!isLoading && !prompt && (
        <p className="text-muted-foreground text-sm">
          Claude has finished or needs a typed reply. Open the session to
          respond.
        </p>
      )}

      {permission && (
        <PermissionCard
          session={session}
          permission={permission}
          variant={page ? "page" : "full"}
          onOpen={onOpen}
        />
      )}

      {question && (
        <>
          {prompt.description && (
            <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-line">
              {prompt.description}
            </p>
          )}
          {prompt.detail && (
            <pre className="bg-background max-h-40 overflow-auto rounded-lg px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {prompt.detail}
            </pre>
          )}
          {prompt.question && (
            <p className="text-sm font-medium">{prompt.question}</p>
          )}
          <AgentsCanAnswer />
          <div className="flex flex-col gap-2">
            {prompt.options.map((option) => (
              <button
                key={`${option.index}-${option.label}`}
                type="button"
                disabled={answering !== null}
                onClick={() => answer(option)}
                className={cn(
                  "flex min-h-[44px] touch-manipulation items-center gap-2 rounded-xl px-3.5 py-2 text-left text-sm font-medium disabled:opacity-60",
                  KIND_STYLE[option.kind],
                  page && option.kind === "deny" && "text-red-400"
                )}
              >
                {answering === option.index && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                )}
                <span className="line-clamp-2">{option.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {page && (
        <button
          type="button"
          onClick={onOpen}
          className="text-muted-foreground border-border active:bg-accent hover:bg-accent flex min-h-[44px] w-full items-center rounded-xl border border-dashed px-3.5 text-left text-sm"
        >
          Or tell Claude what to do instead…
        </button>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </Root>
  );
}
