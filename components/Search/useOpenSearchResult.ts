"use client";

import { useCallback, useMemo, useRef } from "react";
import { useProjectConfig } from "@/hooks/useProjectConfig";
import { useScriptRunner } from "@/components/Projects/useScriptRunner";
import { jumpTo } from "@/components/ReplyContext/store";
import { openBeside } from "@/stores/beside";
import { mobileNavActions } from "@/stores/mobileNav";
import { openScripts } from "@/stores/scriptsSheet";
import { requestSearchAction } from "@/stores/searchActions";
import { setOrigin } from "@/stores/back";
import { openSteps, type OpenStep } from "./open-result";
import type {
  OpenResultOptions,
  SearchResult,
  SearchSurfaceProps,
} from "./types";

/**
 * What choosing a row does, shared by the palette and the page; closes the
 * search after. A session opens (or opens beside); a message opens its
 * session in chat and jumps to the item (ReplyContext jumpTo, loading
 * earlier history until it's there); a file opens at its line; a script
 * runs as the Scripts sheet's play; a slash command or turn action goes to
 * the session through stores/searchActions. Owned by U11.4
 */
export function useOpenSearchResult(
  props: Pick<
    SearchSurfaceProps,
    | "sessions"
    | "onOpenChange"
    | "onSelectSession"
    | "onSelectFile"
    | "currentSessionId"
  >
): (result: SearchResult, options?: OpenResultOptions) => void {
  const { sessions, currentSessionId } = props;
  // Scripts run with the focused session's project (the Scripts sheet's
  // runner); another project's open its sheet instead
  const projectId =
    sessions.find((s) => s.id === currentSessionId)?.project_id ?? null;
  const { data: config } = useProjectConfig(projectId);
  const { run } = useScriptRunner(projectId, currentSessionId);
  const scripts = config?.config.scripts;
  const scriptIds = useMemo(() => scripts?.map((s) => s.id) ?? [], [scripts]);

  const latest = useRef({ props, run, scripts, projectId, scriptIds });
  latest.current = { props, run, scripts, projectId, scriptIds };

  return useCallback((result: SearchResult, options?: OpenResultOptions) => {
    const { props, run, scripts, projectId, scriptIds } = latest.current;
    const steps = openSteps(
      result,
      {
        currentSessionId: props.currentSessionId,
        runnerProjectId: projectId,
        runnerScriptIds: scriptIds,
      },
      options
    );
    const perform = (step: OpenStep) => {
      switch (step.kind) {
        case "select":
          return props.onSelectSession(step.sessionId);
        case "beside":
          return openBeside(step.sessionId, "chat");
        case "chat":
          return mobileNavActions.requestViewMode("chat", step.sessionId);
        case "jump":
          return jumpTo(step.sessionId, step.itemId, {
            switchView: step.switchView,
          });
        case "file":
          return props.onSelectFile?.(step.file, step.line);
        case "runScript": {
          const script = scripts?.find((s) => s.id === step.scriptId);
          if (!script)
            return openScripts(step.projectId, props.currentSessionId);
          void run(script, {
            announce: true,
            // The trust prompt would be gone with the search: the sheet asks
            onUntrusted: () =>
              openScripts(step.projectId, props.currentSessionId),
          });
          return;
        }
        case "openScripts":
          return openScripts(step.projectId, props.currentSessionId);
        case "request":
          return requestSearchAction(step.request);
      }
    };
    // Back from what it opens reopens Find, on the same query
    for (const step of steps)
      if (
        step.kind === "select" ||
        step.kind === "chat" ||
        step.kind === "jump"
      ) {
        setOrigin(
          step.sessionId,
          { kind: "search" },
          props.currentSessionId ?? null
        );
        break;
      } else if (step.kind === "file" && props.currentSessionId) {
        setOrigin(props.currentSessionId, { kind: "search" });
        break;
      }
    steps.forEach(perform);
    props.onOpenChange(false);
  }, []);
}
