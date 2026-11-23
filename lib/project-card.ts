/**
 * A project as it travels to another machine (lib/project-move-types.ts):
 * read here, recreated there. Server only.
 */

import { getDb } from "./db";
import type { DevServerType } from "./db";
import { isSafeModelName } from "./model-name";
import { createProject, getProjectWithDevServers } from "./projects";
import { isValidAgentType } from "./providers";
import type { ProjectCard } from "./project-move-types";

/** The project's card; null for Uncategorized or one that is gone */
export function cardOf(
  projectId: string | null | undefined
): ProjectCard | null {
  if (!projectId) return null;
  const project = getProjectWithDevServers(projectId);
  if (!project || project.is_uncategorized) return null;
  return {
    name: project.name,
    agentType: project.agent_type,
    defaultModel: project.default_model,
    initialPrompt: project.initial_prompt ?? null,
    instructions: project.instructions ?? null,
    group: project.group_name ?? null,
    devServers: project.devServers.slice(0, 20).map((d) => ({
      name: d.name,
      type: d.type,
      command: d.command,
      port: d.port ?? null,
      portEnvVar: d.port_env_var ?? null,
    })),
  };
}

const DEV_TYPES: readonly string[] = ["node", "docker"];

/** A new project in `folder` from a card; answers its id */
export function createFromCard(folder: string, card: ProjectCard): string {
  const project = createProject({
    name: card.name.trim().slice(0, 80),
    workingDirectory: folder,
    agentType: isValidAgentType(card.agentType) ? card.agentType : undefined,
    defaultModel: isSafeModelName(card.defaultModel)
      ? card.defaultModel
      : undefined,
    initialPrompt: card.initialPrompt ?? undefined,
    devServers: card.devServers
      .filter((d) => DEV_TYPES.includes(d.type))
      .map((d) => ({
        name: d.name,
        type: d.type as DevServerType,
        command: d.command,
        port: d.port ?? undefined,
        portEnvVar: d.portEnvVar ?? undefined,
      })),
  });
  const instructions = card.instructions?.trim() || null;
  const group = card.group?.trim() || null;
  if (instructions || group) {
    getDb()
      .prepare(
        "UPDATE projects SET instructions = ?, group_name = ? WHERE id = ?"
      )
      .run(instructions, group, project.id);
  }
  return project.id;
}
