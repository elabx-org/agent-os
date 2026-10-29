"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useCreateSession, useSessionsQuery } from "@/data/sessions";
import { useProjectsQuery } from "@/data/projects";
import { freshSessionInput, requestOpenSession } from "@/lib/bg-send";
import { markFresh } from "@/stores/bgSend";

export interface BackgroundSend {
  /**
   * "Send and start a new session": runs `deliver` (the composer's normal
   * send to this session, through the server queue); only when it went
   * (true) creates the fresh session (lib/bg-send.ts freshSessionInput),
   * marks it fresh with the sent-to toast (stores/bgSend.ts) and opens it
   * (requestOpenSession). Resolves false when nothing was created.
   * `fromKey` (⌘Return): Full access starts the new one in Auto
   */
  sendAndStartNew: (
    deliver: () => Promise<boolean>,
    fromKey?: boolean
  ) => Promise<boolean>;
  /** Creating the fresh session */
  starting: boolean;
  /** The session is known (in the sessions list) and can start another */
  available: boolean;
}

/** M10 background send for the composer of `sessionId` */
export function useBackgroundSend(sessionId: string): BackgroundSend {
  const { data: sessionsData } = useSessionsQuery();
  const { data: projects } = useProjectsQuery();
  const createSession = useCreateSession();
  const [starting, setStarting] = useState(false);
  // A second tap before the state lands
  const busy = useRef(false);

  const session = sessionsData?.sessions.find((s) => s.id === sessionId);
  const projectDir = session?.project_id
    ? projects?.find((p) => p.id === session.project_id)?.working_directory
    : undefined;

  const sendAndStartNew = useCallback(
    async (deliver: () => Promise<boolean>, fromKey = false) => {
      if (!session || busy.current) return false;
      busy.current = true;
      setStarting(true);
      try {
        if (!(await deliver())) return false;
        try {
          const { session: created } = await createSession.mutateAsync(
            freshSessionInput(session, projectDir, fromKey)
          );
          markFresh(created.id, { id: session.id, name: session.name });
          requestOpenSession(created);
          return true;
        } catch (error) {
          // The message went; only the new session didn't start
          toast.error(
            `Sent, but the new session didn't start: ${
              error instanceof Error ? error.message : "unknown error"
            }`
          );
          return false;
        }
      } finally {
        busy.current = false;
        setStarting(false);
      }
    },
    [session, projectDir, createSession]
  );

  return { sendAndStartNew, starting, available: !!session };
}
