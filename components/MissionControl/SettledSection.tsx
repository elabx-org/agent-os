"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { GroupCard } from "@/components/a/GroupCard";
import { PrChip } from "@/components/a/PrChip";
import { displayTitle } from "@/hooks/useSessionTitles";
import type { Session } from "@/lib/db";
import { sessionPr, settledLine } from "@/lib/settle-types";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./NowSections";

/**
 * "Settled today · N" (N-Settle): a collapsible group under Working, each
 * row "Settled automatically · PR #106 merged" with its PR chip; opening a
 * row shows its readable chat. Folded, it shows the latest one. The wide
 * page lists them under Done today instead (Open-Now)
 */
export function SettledSection({
  now,
  wide,
  onOpenSession,
}: Pick<SectionProps, "now" | "wide" | "onOpenSession">) {
  const [open, setOpen] = useState(false);
  const { settled } = now;
  if (wide || !settled.length) return null;

  const more = settled.length > 1;
  const header = (
    <>
      <span className="bg-work/14 text-work flex h-7 w-7 flex-none items-center justify-center rounded-full">
        <Check aria-hidden className="h-4 w-4" strokeWidth={2.6} />
      </span>
      <span className="text-foreground min-w-0 flex-1 truncate text-left text-[16px] font-semibold">
        Settled today · {settled.length}
      </span>
      {more && (
        <ChevronDown
          aria-hidden
          strokeWidth={2}
          className={cn(
            "h-4 w-4 flex-none text-[#AEAEB2] transition-transform dark:text-[#636366]",
            open && "rotate-180"
          )}
        />
      )}
    </>
  );

  return (
    <section className="flex flex-col gap-3.5">
      <GroupCard aria-label="Settled today">
        {more ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="row active:bg-accent min-h-12 w-full"
          >
            {header}
          </button>
        ) : (
          <div className="row min-h-12">{header}</div>
        )}
        {(open ? settled : settled.slice(0, 1)).map((session) => (
          <SettledRow
            key={session.id}
            session={session}
            title={displayTitle(session, now.titles).title}
            onOpen={() => onOpenSession(session)}
          />
        ))}
      </GroupCard>
      <p className="text-muted-foreground px-1 text-[13px]">
        A session settles when its PR merges, or when you swipe it. The chat
        stays readable and the tmux window closes.
      </p>
    </section>
  );
}

/** One settled session: small avatar, its title, how it settled, its PR */
function SettledRow({
  session,
  title,
  onOpen,
}: {
  session: Session;
  title: string;
  onOpen: () => void;
}) {
  const pr = sessionPr(session);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="row active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 w-full items-start text-left"
    >
      <Avatar
        {...agentAvatar(session.agent_type)}
        size="sm"
        className="mx-1.5 mt-0.5"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="min-w-0">
          <span className="block truncate text-[15px] text-[#3A3A3F] dark:text-[#C7C7CC]">
            {title}
          </span>
          <span className="text-muted-foreground block truncate text-[13px]">
            {settledLine(session)}
          </span>
        </span>
        {pr && <PrChip pr={pr} baseBranch={session.base_branch} />}
      </span>
    </button>
  );
}
