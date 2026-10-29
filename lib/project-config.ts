/**
 * M3: a project's `.agent-os.json` (lib/project-config-types.ts): read with
 * the legacy `.agent-os/worktrees.json` precedence for setup/devServer,
 * written pretty-printed with unknown keys kept, and the trust gate
 * (project_trust, migration 27) that keeps repo-file commands from running
 * before the user approves that file's hash once.
 *
 * Contract stubs: U3.1 implements.
 */

import type {
  AgentOsConfig,
  ProjectConfigResponse,
  ResolvedProjectDefaults,
} from "./project-config-types";

export * from "./project-config-types";

const TODO = "M3 U3.1: not implemented";

export interface ReadConfigResult {
  /** `.agent-os.json` alone, unknown keys and all (what the editor writes back) */
  file: AgentOsConfig;
  /** What runs: file + legacy setup/devServer when the legacy file has them */
  effective: AgentOsConfig;
  exists: boolean;
  path: string;
  legacy: ProjectConfigResponse["legacy"];
  hash: string;
  text: string;
}

/** Reads both files; a missing or broken file reads as {} */
export async function readProjectConfig(
  _projectPath: string
): Promise<ReadConfigResult> {
  throw new Error(TODO);
}

/** sha256 hex over `.agent-os.json` + "\0" + `.agent-os/worktrees.json` ("" if neither) */
export function configHash(
  _configText: string | null,
  _legacyText: string | null
): string {
  throw new Error(TODO);
}

/**
 * Writes `.agent-os.json` (2-space JSON, trailing newline) if the current
 * hash is still baseHash; returns the new hash, or null on a conflict
 */
export async function writeProjectConfig(
  _projectPath: string,
  _config: AgentOsConfig,
  _baseHash: string
): Promise<{ hash: string } | null> {
  throw new Error(TODO);
}

/** Trusted: approved hash, or nothing in the files can run */
export function isTrusted(_projectId: string, _hash: string): boolean {
  throw new Error(TODO);
}

export function trustConfig(_projectId: string, _hash: string): void {
  throw new Error(TODO);
}

/**
 * Once ever (a preferences marker): trust the config hashes present now,
 * so projects that already had a file keep running its setup unasked
 */
export async function seedInitialTrust(): Promise<void> {
  throw new Error(TODO);
}

/** The defaults a new session in this project gets (Full access only if the user chose it) */
export async function resolveProjectDefaults(
  _projectId: string
): Promise<ResolvedProjectDefaults> {
  throw new Error(TODO);
}

/** The full GET response for a project */
export async function projectConfigResponse(
  _projectId: string
): Promise<ProjectConfigResponse | null> {
  throw new Error(TODO);
}
