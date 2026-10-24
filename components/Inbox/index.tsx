"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Loader2, SquareTerminal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";
import type {
  PermissionPrompt,
  PromptOption,
  PromptOptionKind,
} from "@/lib/permission-prompt";

const KIND_STYLE: Record<PromptOptionKind, string> = {
  allow: "bg-primary text-primary-foreground active:opacity-80",
  always: "bg-secondary text-foreground border-border border active:bg-accent",
  deny: "border border-red-500/40 bg-red-500/15 text-red-400 active:bg-red-500/25",
  other: "bg-secondary text-foreground active:bg-accent",
};

async function fetchPrompt(id: string): Promise<PermissionPrompt | null> {
  const res = await fetch(`/api/sessions/${id}/prompt`);
  if (!res.ok) return null;
  return (await res.json()).prompt ?? null;
}

export function InboxItem({
  session,
  projectName,
  onOpen,
  questionsOnly,
}: {
  session: Session;
  projectName?: string;
  onOpen: () => void;
  /** Render nothing unless Claude is asking a question (inline in Chat) */
  questionsOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["session-prompt", session.id];
  const { data: prompt, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchPrompt(session.id),
    refetchInterval: 2000,
  });
  const [answering, setAnswering] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (option: PromptOption) => {
    setAnswering(option.index);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: option.index, label: option.label }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Couldn't answer");
      }
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setAnswering(null);
      queryClient.invalidateQueries({ queryKey });
    }
  };

  if (questionsOnly && !prompt) return null;

  return (
    <li className="bg-card border-border space-y-3 rounded-2xl border p-3.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-4 ring-amber-400/20"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{session.name}</p>
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
            <pre className="bg-background border-border max-h-40 overflow-auto rounded-xl border px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
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
    </li>
  );
}

interface InboxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  waitingSessions: Session[];
  projectNames: Record<string, string>;
  onOpenSession: (session: Session) => void;
}

/** Everything waiting on you, answerable without opening the terminal */
export function InboxDialog({
  open,
  onOpenChange,
  waitingSessions,
  projectNames,
  onOpenSession,
}: InboxDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85dvh,720px)] flex-col gap-3 overflow-hidden p-4 sm:max-w-md">
        <div>
          <DialogTitle className="text-base">Inbox</DialogTitle>
          <DialogDescription className="text-xs">
            {waitingSessions.length
              ? `${waitingSessions.length} waiting on you`
              : "Nothing is waiting on you"}
          </DialogDescription>
        </div>
        {waitingSessions.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
            <InboxIcon className="h-6 w-6" />
            All clear
          </div>
        ) : (
          <ul className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
            {waitingSessions.map((session) => (
              <InboxItem
                key={session.id}
                session={session}
                projectName={
                  session.project_id
                    ? projectNames[session.project_id]
                    : undefined
                }
                onOpen={() => {
                  onOpenChange(false);
                  onOpenSession(session);
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
