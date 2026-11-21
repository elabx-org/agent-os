"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { hubFetch } from "@/lib/client/machine";
import { copyAge, type BackupView } from "@/lib/backup/types";
import type { ChatItem, TranscriptChunk } from "@/lib/claude-transcript";

/**
 * A copy's conversation, read only: no composer, nothing runs. "Continue
 * on {hubName}" opens the take-over sheet, or says why it can't
 */
export function CopyViewer({
  machineId,
  machineName,
  hubName,
  copy,
  onContinue,
}: {
  machineId: string;
  machineName: string;
  hubName: string;
  copy: BackupView;
  onContinue: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["machines", "copy", machineId, copy.sessionId, copy.copiedAt],
    queryFn: async () => {
      const res = await hubFetch(
        `/api/machines/${machineId}/backups/${copy.sessionId}/transcript`
      );
      if (!res.ok) return null;
      return (await res.json()) as Partial<TranscriptChunk> & {
        notFound?: boolean;
      };
    },
    staleTime: 10_000,
  });
  const items = (data?.items ?? []).filter(
    (item): item is Extract<ChatItem, { kind: "user" | "assistant" }> =>
      item.kind === "user" || item.kind === "assistant"
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-1">
      <div className="min-w-0">
        <h2 className="t-title truncate text-[20px] leading-tight font-bold">
          {copy.name}
        </h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Copy from {machineName} · {copyAge(Date.now() - copy.copiedAt)} ago ·
          read only
        </p>
      </div>
      <div className="bg-card min-h-0 flex-1 overflow-y-auto rounded-2xl px-4 py-3">
        {isLoading ? (
          <Loader2 aria-hidden className="mx-auto h-5 w-5 animate-spin" />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-[15px]">
            Nothing to show in this copy.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className={
                  item.kind === "user"
                    ? "bg-accent self-end rounded-2xl px-3 py-2 text-[15px] whitespace-pre-wrap"
                    : "text-[15px] break-words whitespace-pre-wrap"
                }
              >
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sticky bottom-0 flex flex-col gap-1.5 bg-[var(--sheet)] pt-1">
        {copy.whyNot && (
          <p className="text-muted-foreground text-center text-[13px]">
            {copy.whyNot}
          </p>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={!copy.canContinue}
          className="pill pill-primary h-[52px] w-full rounded-[26px] text-base active:opacity-80 disabled:opacity-50"
        >
          <span className="truncate">Continue on {hubName}</span>
        </button>
      </div>
    </div>
  );
}
