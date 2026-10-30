"use client";

import { toast } from "sonner";
import { GroupCard } from "@/components/a/GroupCard";
import { SectionTitle } from "@/components/a/SectionTitle";
import {
  useProjectConfig,
  useScriptRuns,
  useStopScriptRun,
} from "@/hooks/useProjectConfig";
import { shortAge } from "@/lib/agent-state";
import type { ProjectWithDevServers } from "@/lib/projects";
import { linkHref } from "@/lib/client/link-target";
import { cn } from "@/lib/utils";
import { openProjectSettings } from "@/stores/projectSettings";
import { openScripts } from "@/stores/scriptsSheet";
import { RoundButton, ScriptRow, useNow } from "./ScriptParts";
import { ScriptIcon } from "./ScriptIcon";
import {
  lastRunText,
  previewPort,
  previewScriptId,
  splitScripts,
} from "./script-view";
import { stopErrorText, useScriptRunner } from "./useScriptRunner";

/**
 * M3 (U3.2): the project page's Scripts section, between Running and
 * Merged today: running scripts first (as Closed-Project's Running rows:
 * port and uptime, Open), then each script with its last run and play;
 * Edit opens the project settings. Nothing for a project with no scripts.
 * Runs here have no session, so every script runs in the background.
 */
export function ProjectScripts({
  project,
}: {
  project: ProjectWithDevServers;
}) {
  const config = useProjectConfig(project.id);
  const file = config.data?.config;
  const has = !!file?.scripts?.length;
  const runs = useScriptRuns(has ? project.id : null);
  const runner = useScriptRunner(project.id, null);
  const stop = useStopScriptRun(project.id);
  const now = useNow();
  if (!has) return null;

  const { running, idle } = splitScripts(file.scripts, runs.data);
  const previewUrl = file.previewUrl?.trim() || undefined;
  const previewId = previewScriptId(running, previewUrl);
  const sheet = () => openScripts(project.id);

  return (
    <>
      {/* ProjectSections' Section (not imported: it re-exports this file) */}
      <section className="flex min-w-0 flex-col gap-2">
        <SectionTitle
          action={{
            label: "Edit",
            onClick: () => openProjectSettings(project.id),
          }}
        >
          Scripts
        </SectionTitle>
        <GroupCard aria-label="Scripts">
          {running.map(({ script, run }) => {
            const preview = script.id === previewId ? previewUrl : undefined;
            const detail = [
              preview && previewPort(preview),
              `up ${shortAge(run!.started_at, now)}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <ScriptRow
                key={script.id}
                leading={<ScriptIcon icon={script.icon} />}
                title={script.name}
                subtitle={
                  <span className="font-mono text-[13px]">{detail}</span>
                }
                onClick={sheet}
                trailing={
                  <span className="flex items-center gap-2">
                    {preview && (
                      <a
                        href={linkHref(preview)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pill pill-secondary pill-sm text-foreground active:opacity-80"
                      >
                        Open
                      </a>
                    )}
                    {/* A terminal run stops in its shell drawer */}
                    {run!.log_path && (
                      <RoundButton
                        kind="stop"
                        small
                        label={`Stop ${script.name}`}
                        busy={stop.isPending && stop.variables === run!.id}
                        onClick={() =>
                          stop.mutate(run!.id, {
                            onError: (e) =>
                              toast.error(stopErrorText(e, script.name)),
                          })
                        }
                      />
                    )}
                  </span>
                }
              />
            );
          })}
          {idle.map(({ script, run }) => {
            const last = lastRunText(run, now);
            return (
              <ScriptRow
                key={script.id}
                leading={<ScriptIcon icon={script.icon} />}
                title={script.name}
                subtitle={
                  last ? (
                    <span
                      className={cn(
                        run?.status === "failed" &&
                          "text-red-600 dark:text-red-300"
                      )}
                    >
                      {last}
                    </span>
                  ) : (
                    <span className="font-mono text-[13px]">
                      {script.command}
                    </span>
                  )
                }
                onClick={sheet}
                trailing={
                  <RoundButton
                    kind="play"
                    small
                    label={`Run ${script.name}`}
                    busy={runner.pendingId === script.id}
                    onClick={() => runner.run(script)}
                  />
                }
              />
            );
          })}
        </GroupCard>
      </section>
      {runner.prompt}
    </>
  );
}
