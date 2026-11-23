"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { confirmAction } from "@/components/ui/confirm";
import { jobModeKey, useJobMode } from "@/data/jobs";
import { fetchOn } from "@/lib/client/machine";
import { refusalText, reprove } from "@/lib/client/user-fetch";
import {
  JOB_MODES,
  JOB_MODE_LABELS,
  jobModeHint,
  type JobMode,
} from "@/lib/jobs/types";

/**
 * How much a job may do on a machine without asking you: the machine's own
 * setting, yours alone to change. Settings, Machines, under the switch that
 * lets this server's sessions use it
 */
export function JobModeRow({ target, name }: { target: string; name: string }) {
  const queryClient = useQueryClient();
  const { data: mode } = useJobMode(target);
  const [saving, setSaving] = useState(false);
  if (!mode) return null;

  const choose = async (next: JobMode) => {
    if (next === mode || saving) return;
    if (next === "auto") {
      const ok = await confirmAction({
        title: `Let jobs work by themselves on ${name}?`,
        message: `A job will run commands in its own folder on ${name} without asking you first, and ask only before something risky. A job never gets full access, and a project's own Claude settings and hooks are not loaded there. You can change this back at any time.`,
        confirmLabel: "Allow",
        cancelLabel: "Not now",
      });
      if (!ok) return;
    }
    setSaving(true);
    const send = () =>
      fetchOn(target, "/api/jobs/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
    try {
      let res = await send();
      if (res.status === 403) {
        await reprove();
        res = await send();
      }
      if (!res.ok) {
        toast.error(refusalText(await res.json().catch(() => ({}))));
        return;
      }
      queryClient.setQueryData(jobModeKey(target), next);
    } catch {
      toast.error(`Couldn't reach ${name}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="row flex-col items-stretch gap-2 py-3 pl-[68px]">
      <span className="text-[15px]" id={`job-mode-${target}`}>
        What a job may do there without asking
      </span>
      <div
        className="seg border-foreground/10 border bg-[var(--block)]"
        role="group"
        aria-labelledby={`job-mode-${target}`}
      >
        {JOB_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === mode}
            disabled={saving}
            onClick={() => void choose(m)}
            className="min-w-0 flex-1 px-2"
          >
            {JOB_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground text-[13px]">
        {jobModeHint(mode, name)}
      </span>
    </div>
  );
}
