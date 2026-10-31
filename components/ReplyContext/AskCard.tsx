"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeMark } from "@/components/UsagePill";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { promptKeys } from "@/data/prompts/queries";
import { replyContextKeys } from "@/hooks/useReplyContext";
import type { AskQuestion } from "@/lib/claude-transcript";
import type { AskAnswer } from "@/lib/ask-screen";

interface AskCardProps {
  sessionId: string;
  questions: AskQuestion[];
  /** The room it may take; it scrolls inside past that */
  maxHeight?: number;
}

interface Draft {
  picks: number[];
  other: string;
}

const answered = (d: Draft) => d.picks.length > 0 || !!d.other.trim();

/**
 * Claude's AskUserQuestion as a card above the composer: each question a
 * step, its options as rows with their descriptions, ticks when several may
 * be picked, and your own words in Other. Send answers presses the keys in
 * Claude for you (POST /ask, lib/ask-screen.ts).
 */
export function AskCard({ sessionId, questions, maxHeight }: AskCardProps) {
  const queryClient = useQueryClient();
  // The same ask keeps its drafts through re-renders and polls
  const askKey = questions.map((q) => q.question).join("\n");
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    questions.map(() => ({ picks: [], other: "" }))
  );
  const [step, setStep] = useState(0);
  const [folded, setFolded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDrafts(questions.map(() => ({ picks: [], other: "" })));
    setStep(0);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey]);

  const q = questions[step];
  const draft = drafts[step] ?? { picks: [], other: "" };
  const last = step === questions.length - 1;
  const allAnswered = useMemo(() => drafts.every(answered), [drafts]);

  const update = (change: (d: Draft) => Draft) =>
    setDrafts((all) => all.map((d, i) => (i === step ? change(d) : d)));

  const pick = (n: number) => {
    setError(null);
    if (q.multiSelect) {
      update((d) => ({
        ...d,
        picks: d.picks.includes(n)
          ? d.picks.filter((p) => p !== n)
          : [...d.picks, n].sort((a, b) => a - b),
      }));
      return;
    }
    // One choice: a pick replaces your own words, and moves on
    update(() => ({ picks: [n], other: "" }));
    if (!last) setStep(step + 1);
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetchAsUser(`/api/sessions/${sessionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: questions.map((x) => ({
            question: x.question,
            multiSelect: !!x.multiSelect,
            optionCount: x.options.length,
          })),
          answers: drafts.map(
            (d): AskAnswer => ({ picks: d.picks, other: d.other.trim() })
          ),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(refusalText(body));
      }
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setSending(false);
      queryClient.invalidateQueries({
        queryKey: replyContextKeys.session(sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: promptKeys.session(sessionId),
      });
    }
  };

  if (folded) {
    return (
      <button
        type="button"
        onClick={() => setFolded(false)}
        className="bg-card border-border mx-1 mb-1.5 flex min-h-[44px] w-[calc(100%-0.5rem)] items-center gap-2 rounded-2xl border px-3 text-left shadow-xl shadow-black/40"
      >
        <ClaudeMark size={11} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {questions.length > 1
            ? `Claude asks ${questions.length} questions`
            : q.question}
        </span>
        <span className="text-primary text-[13px] font-semibold">Answer</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Claude asks"
      style={{ maxHeight }}
      className="bg-card border-border animate-in fade-in mx-1 mb-1.5 flex flex-col gap-2.5 overflow-y-auto rounded-2xl border px-3 pt-2.5 pb-3 shadow-xl shadow-black/40 duration-150"
    >
      <div className="flex items-center gap-2">
        <ClaudeMark size={11} />
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Claude asks
        </span>
        {questions.length > 1 && (
          <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">
            {step + 1} of {questions.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => setFolded(true)}
          aria-label="Fold the questions away"
          className={cn(
            "text-muted-foreground -mr-1 flex h-8 w-8 items-center justify-center rounded-full",
            questions.length > 1 ? "" : "ml-auto"
          )}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {questions.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {questions.map((x, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === step}
              onClick={() => setStep(i)}
              className={cn(
                "flex h-8 items-center gap-1 rounded-full px-3 text-[12.5px] font-semibold",
                i === step
                  ? "bg-foreground text-background"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {x.header || `Question ${i + 1}`}
              {answered(drafts[i] ?? { picks: [], other: "" }) && (
                <Check aria-label="answered" className="h-3.5 w-3.5" />
              )}
            </button>
          ))}
        </div>
      )}

      <p className="text-[16px] leading-snug font-semibold text-balance">
        {q.question}
      </p>
      {q.multiSelect && (
        <p className="text-muted-foreground -mt-1.5 text-xs">
          Pick as many as you like.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {q.options.map((o, n) => {
          const on = draft.picks.includes(n);
          return (
            <button
              key={n}
              type="button"
              role={q.multiSelect ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => pick(n)}
              className={cn(
                "flex min-h-[48px] w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left",
                on
                  ? "border-primary bg-primary/10"
                  : "border-border bg-secondary active:bg-accent"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border-2",
                  q.multiSelect ? "rounded-md" : "rounded-full",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/60"
                )}
              >
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] leading-tight font-semibold">
                  {o.label}
                </span>
                {o.description && (
                  <span className="text-muted-foreground mt-0.5 block text-[13px] leading-snug">
                    {o.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <label className="border-border flex min-h-[48px] items-center gap-3 rounded-xl border border-dashed px-3 py-2">
          <span
            aria-hidden="true"
            className={cn(
              "h-5 w-5 shrink-0 border-2 border-dashed",
              q.multiSelect ? "rounded-md" : "rounded-full",
              draft.other.trim()
                ? "border-primary"
                : "border-muted-foreground/60"
            )}
          />
          <input
            id={`ask-other-${step}`}
            value={draft.other}
            onChange={(e) => {
              const other = e.target.value;
              setError(null);
              // One choice: your own words replace the pick
              update((d) => ({
                picks: q.multiSelect || !other.trim() ? d.picks : [],
                other,
              }));
            }}
            placeholder="Other: your own words"
            enterKeyHint={last ? "send" : "next"}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (!last) setStep(step + 1);
              else if (allAnswered && !sending) send();
            }}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {/* Pinned, so Send stays in reach when the card scrolls */}
      <div className="bg-card sticky -bottom-3 -mx-3 -mb-3 flex items-center gap-2 px-3 pt-1 pb-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="bg-secondary h-11 rounded-full px-4 text-[14px] font-semibold"
          >
            Back
          </button>
        )}
        {last ? (
          <button
            type="button"
            disabled={!allAnswered || sending}
            onClick={send}
            className="bg-primary text-primary-foreground flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold disabled:opacity-45"
          >
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {questions.length > 1 ? "Send answers" : "Send answer"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!answered(draft)}
            onClick={() => setStep(step + 1)}
            className="bg-primary text-primary-foreground h-11 flex-1 rounded-full text-[15px] font-semibold disabled:opacity-45"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
