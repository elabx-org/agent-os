"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeMark } from "@/components/UsagePill";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { replyContextKeys } from "@/hooks/useReplyContext";
import type { MessageChoices } from "@/lib/message-choices";

interface ChoiceCardProps {
  sessionId: string;
  choices: MessageChoices;
  /** The room it may take; it scrolls inside past that */
  maxHeight?: number;
  /** Sent, or put away: gone until Claude's next turn */
  onDone: () => void;
}

/**
 * A question Claude asked in its message, not through AskUserQuestion, with
 * the replies it suggests as taps. A one-line bar until opened: the guess
 * can be wrong, so it never takes the screen on its own. Send types the
 * reply into Claude's prompt, as the composer would.
 */
export function ChoiceCard({
  sessionId,
  choices,
  maxHeight,
  onDone,
}: ChoiceCardProps) {
  const [folded, setFolded] = useState(true);
  const [pick, setPick] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const reply =
    other.trim() || (pick !== null ? choices.choices[pick].reply : "");

  const send = async () => {
    if (!reply) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetchAsUser(`/api/sessions/${sessionId}/send-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply, pressEnter: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(refusalText(body));
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setSending(false);
      queryClient.invalidateQueries({
        queryKey: replyContextKeys.session(sessionId),
      });
    }
  };

  if (folded) {
    return (
      <div className="bg-card border-border mx-1 mb-1.5 flex min-h-[44px] items-center rounded-2xl border pl-3 shadow-xl shadow-black/40">
        <button
          type="button"
          onClick={() => setFolded(false)}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ClaudeMark size={11} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {choices.question}
          </span>
          <span className="text-primary text-[13px] font-semibold">Reply</span>
        </button>
        <button
          type="button"
          onClick={onDone}
          aria-label="Put the replies away"
          className="text-muted-foreground flex h-11 w-10 shrink-0 items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Reply to Claude"
      style={{ maxHeight }}
      className="bg-card border-border animate-in fade-in mx-1 mb-1.5 flex flex-col gap-2.5 overflow-y-auto rounded-2xl border px-3 pt-2.5 pb-3 shadow-xl shadow-black/40 duration-150"
    >
      <div className="flex items-center gap-2">
        <ClaudeMark size={11} />
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Reply to Claude
        </span>
        <button
          type="button"
          onClick={() => setFolded(true)}
          aria-label="Fold the replies away"
          className="text-muted-foreground -mr-1 ml-auto flex h-8 w-8 items-center justify-center rounded-full"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <p className="text-[16px] leading-snug font-semibold text-balance">
        {choices.question}
      </p>

      <div className="flex flex-col gap-1.5" role="radiogroup">
        {choices.choices.map((c, n) => {
          const on = pick === n && !other.trim();
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setPick(n);
                setOther("");
                setError(null);
              }}
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
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/60"
                )}
              >
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] leading-tight font-semibold">
                  {c.label}
                </span>
                {c.detail && (
                  <span className="text-muted-foreground mt-0.5 block text-[13px] leading-snug">
                    {c.detail}
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
              "h-5 w-5 shrink-0 rounded-full border-2 border-dashed",
              other.trim() ? "border-primary" : "border-muted-foreground/60"
            )}
          />
          <input
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              setError(null);
            }}
            placeholder="Other: your own words"
            enterKeyHint="send"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (!sending) send();
            }}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {/* Pinned, so Send stays in reach when the card scrolls */}
      <div className="bg-card sticky -bottom-3 -mx-3 -mb-3 flex items-center gap-2 px-3 pt-1 pb-3">
        <button
          type="button"
          disabled={!reply || sending}
          onClick={send}
          className="bg-primary text-primary-foreground flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold disabled:opacity-45"
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          Send
        </button>
      </div>
    </div>
  );
}
