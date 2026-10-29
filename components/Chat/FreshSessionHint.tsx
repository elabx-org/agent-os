"use client";

import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import { agentName } from "@/components/a/Avatar";
import { useProjectsQuery } from "@/data/projects";
import { bgSendStore } from "@/stores/bgSend";
import type { Project, Session } from "@/lib/db";

/** Where the fresh session runs: its project's name, else its folder's */
export function freshSessionPlace(
  session: Pick<Session, "project_id" | "working_directory">,
  projects: Pick<Project, "id" | "name" | "is_uncategorized">[]
): string {
  const project = session.project_id
    ? projects.find((p) => p.id === session.project_id)
    : undefined;
  if (project && !project.is_uncategorized && project.name) return project.name;
  const dir = (session.working_directory || "").replace(/\/+$/, "");
  return dir.slice(dir.lastIndexOf("/") + 1) || dir || "this folder";
}

/** An empty fresh session's chat: "Claude is ready in agent-os. Say what
    to do." (N-BgSend), in place of "No conversation found" */
export function FreshSessionHint({ session }: { session: Session }) {
  const { data: projects = [] } = useProjectsQuery();
  const { toast } = useSnapshot(bgSendStore);
  // The sent toast floats over the top of the chat: start below it
  const underToast = toast?.sessionId === session.id;
  return (
    <div
      className={cn(
        "text-muted-foreground pb-8 text-sm",
        underToast ? "pt-24" : "pt-8"
      )}
    >
      {agentName(session.agent_type)} is ready in{" "}
      <span className="text-foreground font-mono text-[13px]">
        {freshSessionPlace(session, projects)}
      </span>
      . Say what to do.
    </div>
  );
}
