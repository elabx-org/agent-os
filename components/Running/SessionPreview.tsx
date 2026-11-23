"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, MonitorPlay } from "lucide-react";
import type { Session } from "@/lib/db";
import {
  previewChoices,
  previewLabel,
  previewShown,
} from "@/lib/session-preview";
import { openPage } from "@/stores/workspacePage";
import { canStop, useRunning } from "./data";
import { Preview } from "./index";

const POLL_MS = 4000;

/**
 * The Mac window's Preview: the page the session's own web server serves,
 * in place of its views. With none running it says so, and offers what other
 * sessions and project scripts serve here (not every app on the machine:
 * the Running page lists those).
 */
export function SessionPreview({ session }: { session: Session }) {
  const { data, isLoading } = useRunning(POLL_MS);
  const choices = useMemo(
    () =>
      previewChoices(
        (data ?? []).filter((s) => s.sessionId === session.id || canStop(s)),
        session.id
      ),
    [data, session.id]
  );
  const [picked, setPicked] = useState<number | null>(null);
  // Another session: its own server again
  useEffect(() => setPicked(null), [session.id]);
  const shown = previewShown(choices, picked);
  const count = choices.mine.length + choices.others.length;

  if (!shown) {
    return (
      <section
        aria-label="Preview"
        className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        {isLoading ? (
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        ) : (
          <>
            <MonitorPlay
              className="text-muted-foreground h-7 w-7"
              aria-hidden="true"
            />
            <h2 className="text-[17px] font-semibold">
              Nothing to preview yet
            </h2>
            <p className="text-muted-foreground max-w-[26rem] text-[14px] text-balance">
              When this session starts a web server, its page shows here.
            </p>
            {choices.others.length > 0 && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <p className="text-muted-foreground text-[13px]">
                  Started by other sessions
                </p>
                <ul className="flex flex-wrap justify-center gap-2">
                  {choices.others.map((server) => (
                    <li key={server.port}>
                      <button
                        type="button"
                        onClick={() => setPicked(server.port)}
                        title={server.command || server.name}
                        className="pill pill-secondary pill-sm font-mono"
                      >
                        {previewLabel(server)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() => openPage({ kind: "running" })}
              className="text-muted-foreground mt-2 text-[13px] underline underline-offset-2"
            >
              See everything running
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Preview" className="flex h-full w-full flex-col">
      {count > 1 && (
        <div className="flex shrink-0 items-center gap-2 px-4 pt-2">
          <label
            htmlFor="preview-server"
            className="text-muted-foreground text-[13px]"
          >
            Showing
          </label>
          <select
            id="preview-server"
            value={shown.port}
            onChange={(event) => setPicked(Number(event.target.value))}
            className="bg-muted min-h-[32px] rounded-full px-3 font-mono text-[13px]"
          >
            {choices.mine.length > 0 && (
              <optgroup label="This session">
                {choices.mine.map((server) => (
                  <option key={server.port} value={server.port}>
                    {previewLabel(server)}
                  </option>
                ))}
              </optgroup>
            )}
            {choices.others.length > 0 && (
              <optgroup label="Started by other sessions">
                {choices.others.map((server) => (
                  <option key={server.port} value={server.port}>
                    {previewLabel(server)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}
      <Preview key={shown.port} server={shown} />
    </section>
  );
}
