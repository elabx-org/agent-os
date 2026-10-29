/**
 * M3: a project's `.agent-os.json` (lib/project-config-types.ts): read with
 * the legacy `.agent-os/worktrees.json` precedence for setup/devServer,
 * written pretty-printed with unknown keys kept, and the trust gate
 * (project_trust, migration 27) that keeps repo-file commands from running
 * before the user approves that file's hash once.
 */

import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, queries } from "@/lib/db";
import { getAllProjects, getProject } from "@/lib/projects";
import { isValidAgentType } from "@/lib/providers";
import { normalizeMode } from "@/lib/permission-mode";
import { isSafeModelName } from "@/lib/model-name";
import {
  canRun,
  CONFIG_FILE,
  LEGACY_CONFIG_FILE,
  type AgentOsConfig,
  type ProjectConfigResponse,
  type ProjectScript,
  type ResolvedProjectDefaults,
} from "./project-config-types";

export * from "./project-config-types";

/** Set once seedInitialTrust has trusted the files present at the first M3 start */
export const TRUST_SEEDED_KEY = "projectTrustSeeded";
/** Project ids whose file may default new sessions to Full access (the user chose it in the UI) */
export const FULL_ACCESS_KEY = "projectFullAccess";

/** Keys this code understands; anything else in the file is kept as is */
const KNOWN_KEYS = new Set([
  "scripts",
  "previewUrl",
  "setup",
  "devServer",
  "defaults",
]);

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

export function expandHome(dir: string): string {
  const home = process.env.HOME || os.homedir();
  if (dir === "~") return home;
  if (dir.startsWith("~/")) return path.join(home, dir.slice(2));
  return dir;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function parseObject(text: string | null): Record<string, unknown> {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "script"
  );
}

/** Drops entries without a name or command, gives each a unique id */
export function normalizeScripts(raw: unknown): ProjectScript[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const scripts: ProjectScript[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const s = entry as Record<string, unknown>;
    if (typeof s.name !== "string" || typeof s.command !== "string") continue;
    let id =
      typeof s.id === "string" && s.id.trim() ? s.id.trim() : slugify(s.name);
    for (let n = 2; seen.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
    seen.add(id);
    scripts.push({ ...(s as unknown as ProjectScript), id });
  }
  return scripts;
}

/** The pure part: both files' text in, what readProjectConfig returns out */
export function parseProjectConfig(
  projectPath: string,
  configText: string | null,
  legacyText: string | null
): ReadConfigResult {
  const root = expandHome(projectPath);
  const file = parseObject(configText) as AgentOsConfig;
  const scripts = normalizeScripts(file.scripts);
  if (scripts) file.scripts = scripts;
  else delete file.scripts;

  const legacyRaw = parseObject(legacyText) as AgentOsConfig;
  const effective: AgentOsConfig = { ...file };
  let legacy: ReadConfigResult["legacy"] = null;
  const legacySetup = Array.isArray(legacyRaw.setup)
    ? legacyRaw.setup.filter((s): s is string => typeof s === "string")
    : undefined;
  const legacyDev =
    legacyRaw.devServer && typeof legacyRaw.devServer.command === "string"
      ? legacyRaw.devServer
      : undefined;
  if (legacySetup || legacyDev) {
    legacy = { path: path.join(root, LEGACY_CONFIG_FILE) };
    if (legacySetup) {
      legacy.setup = legacySetup;
      effective.setup = legacySetup;
    }
    if (legacyDev) {
      legacy.devServer = legacyDev;
      effective.devServer = legacyDev;
    }
  }
  if (effective.setup !== undefined) {
    effective.setup = Array.isArray(effective.setup)
      ? effective.setup.filter((s): s is string => typeof s === "string")
      : undefined;
  }

  return {
    file,
    effective,
    exists: configText !== null,
    path: path.join(root, CONFIG_FILE),
    legacy,
    hash: configHash(configText, legacyText),
    text: configText ?? "",
  };
}

/** Reads both files; a missing or broken file reads as {} */
export async function readProjectConfig(
  projectPath: string
): Promise<ReadConfigResult> {
  return readProjectConfigSync(projectPath);
}

export function readProjectConfigSync(projectPath: string): ReadConfigResult {
  const root = expandHome(projectPath);
  return parseProjectConfig(
    root,
    readText(path.join(root, CONFIG_FILE)),
    readText(path.join(root, LEGACY_CONFIG_FILE))
  );
}

/** sha256 hex over `.agent-os.json` + "\0" + `.agent-os/worktrees.json` ("" if neither) */
export function configHash(
  configText: string | null,
  legacyText: string | null
): string {
  if (configText === null && legacyText === null) return "";
  return createHash("sha256")
    .update(`${configText ?? ""}\0${legacyText ?? ""}`)
    .digest("hex");
}

/** The file text for a config: 2-space JSON, trailing newline */
export function serializeConfig(config: AgentOsConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Writes `.agent-os.json` (2-space JSON, trailing newline) if the current
 * hash is still baseHash; returns the new hash, or null on a conflict.
 * Unknown keys on disk that the edit left out are kept; the legacy file is
 * never touched.
 */
export async function writeProjectConfig(
  projectPath: string,
  config: AgentOsConfig,
  baseHash: string
): Promise<{ hash: string } | null> {
  const root = expandHome(projectPath);
  const file = path.join(root, CONFIG_FILE);
  const current = readText(file);
  const legacyText = readText(path.join(root, LEGACY_CONFIG_FILE));
  if (configHash(current, legacyText) !== baseHash) return null;

  const onDisk = parseObject(current);
  const merged: AgentOsConfig = { ...config };
  for (const [key, value] of Object.entries(onDisk)) {
    if (!KNOWN_KEYS.has(key) && !(key in merged)) merged[key] = value;
  }
  const text = serializeConfig(merged);
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  await fs.promises.writeFile(tmp, text, "utf-8");
  try {
    await fs.promises.rename(tmp, file);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true });
    throw error;
  }
  return { hash: configHash(text, legacyText) };
}

function hasTrustRow(projectId: string, hash: string): boolean {
  return !!getDb()
    .prepare(
      `SELECT 1 FROM project_trust WHERE project_id = ? AND config_hash = ?`
    )
    .get(projectId, hash);
}

/** Trusted for an already-read config (no second read) */
export function isConfigTrusted(
  projectId: string,
  read: Pick<ReadConfigResult, "hash" | "effective">
): boolean {
  if (!read.hash || !canRun(read.effective)) return true;
  return hasTrustRow(projectId, read.hash);
}

/** Trusted: approved hash, or nothing in the files can run */
export function isTrusted(projectId: string, hash: string): boolean {
  if (!hash) return true;
  if (hasTrustRow(projectId, hash)) return true;
  const project = getProject(projectId);
  if (!project) return false;
  const read = readProjectConfigSync(project.working_directory);
  return read.hash === hash && !canRun(read.effective);
}

/** Whether the user ever approved a version of this project's files */
export function everApproved(projectId: string): boolean {
  return !!getDb()
    .prepare(`SELECT 1 FROM project_trust WHERE project_id = ? LIMIT 1`)
    .get(projectId);
}

export function trustConfig(projectId: string, hash: string): void {
  if (!hash) return;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO project_trust (project_id, config_hash, trusted_at) VALUES (?, ?, ?)`
    )
    .run(projectId, hash, Date.now());
}

/** When this server process started (epoch ms) */
const PROCESS_START = Date.now() - process.uptime() * 1000;

/** Either config file was written after this process started */
function changedSinceStart(projectPath: string): boolean {
  const root = expandHome(projectPath);
  return [CONFIG_FILE, LEGACY_CONFIG_FILE].some((name) => {
    try {
      return fs.statSync(path.join(root, name)).mtimeMs > PROCESS_START;
    } catch {
      return false;
    }
  });
}

let seeding: Promise<void> | null = null;

/**
 * Once ever (a preferences marker): trust the config hashes present now,
 * so projects that already had a file keep running its setup unasked
 */
export async function seedInitialTrust(): Promise<void> {
  seeding ??= (async () => {
    const db = getDb();
    if (queries.getPreference(db).get(TRUST_SEEDED_KEY)) return;
    let trusted = 0;
    for (const project of getAllProjects()) {
      if (project.is_uncategorized) continue;
      const read = readProjectConfigSync(project.working_directory);
      if (!read.hash || !canRun(read.effective)) continue;
      // Seeded lazily (first read), so only files already there at start
      if (changedSinceStart(project.working_directory)) continue;
      trustConfig(project.id, read.hash);
      trusted++;
    }
    queries
      .upsertPreference(db)
      .run(TRUST_SEEDED_KEY, JSON.stringify({ at: Date.now(), trusted }));
    if (trusted) {
      console.log(
        `[project-config] trusted ${trusted} existing config file(s)`
      );
    }
  })().catch((error) => {
    seeding = null;
    console.error("[project-config] trust seed failed:", error);
  });
  return seeding;
}

function fullAccessProjects(): string[] {
  const row = queries.getPreference(getDb()).get(FULL_ACCESS_KEY) as
    | { value: string }
    | undefined;
  try {
    const list = row ? JSON.parse(row.value) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function allowsFullAccess(projectId: string): boolean {
  return fullAccessProjects().includes(projectId);
}

/** PUT's allowFullAccess: the user's choice, kept in the DB, never in the file */
export function setProjectFullAccess(projectId: string, allow: boolean): void {
  const list = fullAccessProjects().filter((id) => id !== projectId);
  if (allow) list.push(projectId);
  queries.upsertPreference(getDb()).run(FULL_ACCESS_KEY, JSON.stringify(list));
}

/** The pure part of resolveProjectDefaults */
export function pickDefaults(
  config: AgentOsConfig,
  opts: { trusted: boolean; fullAccess: boolean }
): ResolvedProjectDefaults {
  const raw = config.defaults;
  if (!raw || typeof raw !== "object") return {};
  const out: ResolvedProjectDefaults = {};
  if (typeof raw.agent === "string" && isValidAgentType(raw.agent)) {
    out.agent = raw.agent;
  }
  // The launch line takes the model, so only an approved file's plain name,
  // and only with the agent it names (another agent's flag would fail)
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (out.agent && opts.trusted && isSafeModelName(model)) {
    out.model = model;
  }
  const mode = normalizeMode(raw.permissionMode);
  // A file anyone can edit picks how much an agent may do unasked only
  // once approved, and Full access only when the user chose it in the UI
  if (mode && (mode === "manual" || opts.trusted)) {
    if (mode !== "bypassPermissions" || opts.fullAccess) {
      out.permissionMode = mode;
    }
  }
  return out;
}

/** The defaults a new session in this project gets (Full access only if the user chose it) */
export async function resolveProjectDefaults(
  projectId: string
): Promise<ResolvedProjectDefaults> {
  const project = getProject(projectId);
  if (!project || project.is_uncategorized) return {};
  await seedInitialTrust();
  const read = readProjectConfigSync(project.working_directory);
  return pickDefaults(read.effective, {
    trusted: isConfigTrusted(projectId, read),
    fullAccess: allowsFullAccess(projectId),
  });
}

/** The project whose folder is `dir`, if any (env-setup has only a path) */
export function projectIdForPath(dir: string): string | null {
  const target = path.resolve(expandHome(dir));
  for (const project of getAllProjects()) {
    if (project.is_uncategorized) continue;
    if (path.resolve(expandHome(project.working_directory)) === target) {
      return project.id;
    }
  }
  return null;
}

/** The full GET response for a project */
export async function projectConfigResponse(
  projectId: string
): Promise<ProjectConfigResponse | null> {
  const project = getProject(projectId);
  if (!project || project.is_uncategorized) return null;
  await seedInitialTrust();
  const read = await readProjectConfig(project.working_directory);
  const trusted = isConfigTrusted(projectId, read);
  return {
    config: read.effective,
    path: read.path,
    exists: read.exists,
    hash: read.hash,
    trusted,
    legacy: read.legacy,
    defaults: pickDefaults(read.effective, {
      trusted,
      fullAccess: allowsFullAccess(projectId),
    }),
    text: read.text,
  };
}
