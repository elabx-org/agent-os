"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  foundText,
  missingText,
  NOTES_MAX,
  systemText,
  type AbilitiesView,
} from "@/lib/abilities-types";
import { fetchOn } from "@/lib/client/machine";
import { refusalText, reprove } from "@/lib/client/user-fetch";
import { abilitiesKey, useAbilities } from "@/data/machines";

/**
 * Settings, Machines: what one machine can do (the tools AgentOS found on
 * it) and the user's own note about it. Each session that starts there is
 * told both (lib/abilities-types.ts)
 */
export function AbilitiesRow({
  target,
  name,
  title = "What it can do",
}: {
  target: string;
  name: string;
  /** The row's heading: the machine's name where two are listed together */
  title?: string;
}) {
  const queryClient = useQueryClient();
  const { data } = useAbilities(target);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  if (!data) return null;

  const put = (view: AbilitiesView) =>
    queryClient.setQueryData(abilitiesKey(target), view);

  const check = async () => {
    setBusy("check");
    try {
      const res = await fetchOn(target, "/api/abilities?fresh=1");
      if (!res.ok) throw new Error();
      put((await res.json()) as AbilitiesView);
    } catch {
      toast.error(`Couldn't check ${name}`);
    }
    setBusy(null);
  };

  const save = async () => {
    const notes = (draft ?? "").trim();
    if (notes === data.notes) return setDraft(null);
    setBusy("save");
    const send = () =>
      fetchOn(target, "/api/abilities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
    let res = await send();
    if (res.status === 403) {
      await reprove();
      res = await send();
    }
    setBusy(null);
    if (!res.ok) {
      toast.error(refusalText(await res.json().catch(() => ({}))));
      return;
    }
    const said = (await res.json()) as { notes: string };
    put({ ...data, notes: said.notes });
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <form
        className="row flex-col items-stretch gap-2 py-3 pl-[68px]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="text-[15px]" htmlFor={`note-${target}`}>
          Your note about {name}
        </label>
        <textarea
          id={`note-${target}`}
          autoFocus
          rows={3}
          value={draft}
          maxLength={NOTES_MAX}
          placeholder="Like: has the signing certificate, use it for App Store builds"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(null);
            }
          }}
          className="bg-foreground/[0.07] min-w-0 resize-none rounded-lg px-3 py-2 text-[15px] outline-none"
        />
        <span className="text-muted-foreground text-[13px]">
          Sessions that start on {name} read this.
        </span>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="pill pill-sm shrink-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy === "save"}
            className="pill pill-primary pill-sm shrink-0 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </form>
    );
  }

  const found = foundText(data.abilities);
  const missing = missingText(data.abilities);
  return (
    <div className="row flex-col items-stretch gap-2 py-3 pl-[68px]">
      <div className="min-w-0">
        <span className="block text-[15px]">{title}</span>
        <span className="block text-[13px]">
          {systemText(data.abilities)}
          {found ? `: ${found}` : ""}
        </span>
        {missing && (
          <span className="text-muted-foreground block text-[13px]">
            Not found: {missing}
          </span>
        )}
        {data.notes && (
          <span className="block text-[13px] break-words">
            Your note: {data.notes}
          </span>
        )}
        <span className="text-muted-foreground block text-[13px]">
          A session that starts on {name} is told this.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDraft(data.notes)}
          className="pill pill-sm"
        >
          {data.notes ? "Edit note" : "Add a note"}
        </button>
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy === "check"}
          className="pill pill-sm disabled:opacity-60"
        >
          {busy === "check" ? "Checking" : "Check again"}
        </button>
      </div>
    </div>
  );
}
