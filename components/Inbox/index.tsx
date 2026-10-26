"use client";

import type { ReactNode } from "react";
import { Loader2, SquareTerminal } from "lucide-react";
import { KindBadge } from "@/components/rows/AgentRow";
import { useAnswerPrompt, useSessionPrompt } from "@/data/prompts/queries";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";
import type { PromptOption, PromptOptionKind } from "@/lib/permission-prompt";

// Amber is "needs you" throughout: the answer that lets Claude go on is the
// filled one, the rest are outlined
export const KIND_STYLE: Record<PromptOptionKind, string> = {
  allow: "bg-amber-400 font-semibold text-amber-950 active:opacity-80",
  always: "border-border border text-foreground active:bg-accent",
  deny: "border-border border text-foreground active:bg-accent",
  other: "border-border border text-foreground active:bg-accent",
};

/**
 * The card's one row of answers: allow plus deny (or the last option), or
 * for a question with neither, its first two. The rest go behind More…
 */
export function splitOptions(options: PromptOption[]) {
  const allow = options.find((o) => o.kind === "allow");
  let main: PromptOption[];
  if (allow) {
    const deny =
      options.find((o) => o.kind === "deny") ?? options[options.length - 1];
    main = deny === allow ? [allow] : [allow, deny];
  } else {
    main = options.slice(0, 2);
  }
  return { main, more: options.length > main.length };
}

// The card's buttons are short: a bare "Yes" reads as Allow and "No" or
// "No, and tell Claude..." as Deny; a question's answers keep their label
export function shortLabel(option: PromptOption): string {
  if (option.kind === "allow" && /^yes\W*$/i.test(option.label)) return "Allow";
  if (
    option.kind === "deny" &&
    /^no(\W*$|, and tell claude)/i.test(option.label)
  )
    return "Deny";
  return option.label;
}

// "Bash command" reads as what Claude wants: "wants to run Bash"
function askLabel(title: string): string {
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
  /** "card": the home's compact prompt with one row of answers */
  variant?: "full" | "card";
  /** Display title; defaults to the session name */
  title?: ReactNode;
  /** "div" when it isn't inside a list */
  as?: "li" | "div";
}) {
  const { data: prompt, isLoading } = useSessionPrompt(session.id);
  const { answer, answering, error } = useAnswerPrompt(session.id);

  if (questionsOnly && !prompt) return null;

  if (variant === "card") {
    const split = prompt ? splitOptions(prompt.options) : null;
    return (
      <Root className="grid gap-2.5 rounded-2xl bg-gradient-to-b from-amber-400/[0.06] to-amber-400/[0.02] p-3.5 pb-3 ring-1 ring-amber-400/35 ring-inset">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 items-center gap-2.5 text-left"
        >
          <KindBadge kind="session" state="needs" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">
              {title ?? session.name}
            </span>
            <span className="text-muted-foreground block truncate text-[12.5px]">
              {[projectName, prompt ? askLabel(prompt.title) : "Your turn"]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </button>

        {isLoading && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the
            session…
          </div>
        )}

        {!isLoading && !prompt && (
          <p className="text-muted-foreground text-[12.5px]">
            Needs a typed reply. Open the session to respond.
          </p>
        )}

        {prompt && split && (
          <>
            {prompt.detail ? (
              <pre className="bg-background border-border line-clamp-3 rounded-[9px] border px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
                {prompt.detail}
              </pre>
            ) : (
              prompt.question && (
                <p className="line-clamp-2 text-sm">{prompt.question}</p>
              )
            )}
            <div className="flex gap-2">
              {split.main.map((option) => (
                <button
                  key={`${option.index}-${option.label}`}
                  type="button"
                  title={option.label}
                  disabled={answering !== null}
                  onClick={() => answer(option)}
                  className={cn(
                    "flex min-h-[44px] min-w-0 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold disabled:opacity-60",
                    KIND_STYLE[option.kind]
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
                className="text-muted-foreground relative -my-1 justify-self-start py-1 text-xs after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-['']"
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

  return (
    <Root className="space-y-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-3.5">
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
            {[projectName, prompt?.title ?? "Your turn"]
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

      {prompt && (
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
          <div className="flex flex-col gap-2">
            {prompt.options.map((option) => (
              <button
                key={`${option.index}-${option.label}`}
                type="button"
                disabled={answering !== null}
                onClick={() => answer(option)}
                className={cn(
                  "flex min-h-[44px] touch-manipulation items-center gap-2 rounded-xl px-3.5 py-2 text-left text-sm font-medium disabled:opacity-60",
                  KIND_STYLE[option.kind]
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

      {error && <p className="text-xs text-red-400">{error}</p>}
    </Root>
  );
}
