/**
 * Claude Code's "/" commands for the composer picker.
 *
 * Claude Code has no token-free way to list its commands, so the list is
 * built from disk the way Claude Code finds them (skills, plugins, user and
 * project commands) plus a maintained list of built-ins.
 */
import fs from "fs";
import os from "os";
import path from "path";

export type CommandSource = "builtin" | "skill" | "plugin" | "user" | "project";

export interface ClaudeCommand {
  /** What follows the "/", e.g. "compact" or "commit-commands:commit" */
  name: string;
  description: string;
  source: CommandSource;
}

export interface ClaudeCommandGroups {
  builtin: ClaudeCommand[];
  skills: ClaudeCommand[];
  plugins: ClaudeCommand[];
  user: ClaudeCommand[];
  project: ClaudeCommand[];
}

// Checked against Claude Code's own "/" menu; bundled skills count as built-in
const BUILTINS: [string, string][] = [
  ["add-dir", "Add a new working directory"],
  ["agents", "Manage agent configurations"],
  ["clear", "Clear conversation history and free up context"],
  ["code-review", "Review the current diff for correctness bugs"],
  ["compact", "Clear history but keep a summary in context"],
  ["config", "Open the settings panel"],
  ["context", "Show current context usage"],
  ["cost", "Show the total cost and duration of this session"],
  ["doctor", "Diagnose and verify your Claude Code installation"],
  ["exit", "Exit the REPL"],
  ["export", "Export the conversation to a file or the clipboard"],
  ["help", "Show help and available commands"],
  ["hooks", "Manage hook configurations for tool events"],
  ["ide", "Manage IDE integrations and show status"],
  ["init", "Initialize a new CLAUDE.md file with codebase documentation"],
  ["install-github-app", "Set up Claude GitHub Actions for a repository"],
  ["login", "Sign in with your Anthropic account"],
  ["logout", "Sign out from your Anthropic account"],
  ["loop", "Run a prompt or slash command on a recurring interval"],
  ["mcp", "Manage MCP servers"],
  ["memory", "Edit Claude memory files"],
  ["model", "Set the AI model for Claude Code"],
  ["output-style", "Set the output style"],
  ["permissions", "Manage allow and deny tool permission rules"],
  ["plugin", "Manage Claude Code plugins"],
  ["pr-comments", "Get comments from a GitHub pull request"],
  ["release-notes", "View release notes"],
  ["resume", "Resume a conversation"],
  ["review", "Review a pull request"],
  ["rewind", "Restore the code and/or conversation to a previous point"],
  ["schedule", "Create or manage scheduled cloud agents"],
  ["security-review", "Security review of the pending changes"],
  ["simplify", "Review changed code for reuse and simplification"],
  ["status", "Show version, model, account and connectivity"],
  ["statusline", "Set up Claude Code's status line UI"],
  ["terminal-setup", "Install Shift+Enter key binding for newlines"],
  ["todos", "List current todo items"],
  ["usage", "Show plan usage limits"],
  ["vim", "Toggle between Vim and Normal editing modes"],
];

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const FRONTMATTER_BYTES = 16 * 1024;

interface FileMeta {
  name?: string;
  description: string;
}

const metaCache = new Map<string, { mtimeMs: number; meta: FileMeta }>();

function unquote(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * name/description from a markdown file's frontmatter. Handles the YAML
 * shapes skills use (plain, quoted, folded ">" and literal "|" blocks);
 * without a description, the first line of the body stands in.
 */
function parseMeta(text: string): FileMeta {
  const fields: Record<string, string> = {};
  let body = text;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    body = text.slice(fm[0].length);
    const lines = fm[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      // Indented lines that follow belong to this key
      const more: string[] = [];
      while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1])) {
        more.push(lines[++i].trim());
      }
      const value = /^[>|][+-]?$/.test(raw)
        ? more.filter(Boolean).join(" ")
        : unquote([raw, ...more.filter(Boolean)].join(" "));
      fields[key] = value;
    }
  }
  const firstLine =
    body
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? "";
  return {
    name: fields.name || undefined,
    description: fields.description || firstLine,
  };
}

/** Frontmatter of one file, re-read only when its mtime changes */
function readMeta(file: string): FileMeta | null {
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = metaCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.meta;
    const fd = fs.openSync(file, "r");
    let text: string;
    try {
      const buf = Buffer.alloc(FRONTMATTER_BYTES);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      text = buf.subarray(0, n).toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
    const meta = parseMeta(text);
    metaCache.set(file, { mtimeMs, meta });
    return meta;
  } catch {
    return null;
  }
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** <dir>/<name>/SKILL.md, named by frontmatter (else the folder) */
function scanSkills(
  dir: string,
  source: CommandSource,
  prefix = ""
): ClaudeCommand[] {
  const out: ClaudeCommand[] = [];
  for (const entry of readDir(dir)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const meta = readMeta(path.join(dir, entry.name, "SKILL.md"));
    if (!meta) continue;
    out.push({
      name: prefix + (meta.name || entry.name),
      description: meta.description,
      source,
    });
  }
  return out;
}

/** *.md under dir (subfolders too); a command is named by its file */
function scanCommands(
  dir: string,
  source: CommandSource,
  prefix = "",
  depth = 0
): ClaudeCommand[] {
  const out: ClaudeCommand[] = [];
  for (const entry of readDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < 3) out.push(...scanCommands(full, source, prefix, depth + 1));
    } else if (entry.name.endsWith(".md")) {
      const meta = readMeta(full);
      if (!meta) continue;
      out.push({
        name: prefix + entry.name.slice(0, -3),
        description: meta.description,
        source,
      });
    }
  }
  return out;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

interface InstalledPlugins {
  plugins?: Record<
    string,
    { scope?: string; installPath?: string; projectPath?: string }[]
  >;
}

interface PluginManifest {
  name?: string;
  commands?: string | string[];
  skills?: string | string[];
}

const asList = (v: string | string[] | undefined) =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Commands and skills of every enabled plugin, as "plugin:name" */
function scanPlugins(cwd: string | null): ClaudeCommand[] {
  const installed = readJson<InstalledPlugins>(
    path.join(CLAUDE_DIR, "plugins", "installed_plugins.json")
  );
  const settings = readJson<{ enabledPlugins?: Record<string, boolean> }>(
    path.join(CLAUDE_DIR, "settings.json")
  );
  const enabled = settings?.enabledPlugins ?? {};
  const out: ClaudeCommand[] = [];

  for (const [key, installs] of Object.entries(installed?.plugins ?? {})) {
    if (enabled[key] === false) continue;
    // Project-scoped installs only count inside their project
    const install = [...(installs ?? [])]
      .reverse()
      .find(
        (i) =>
          i.installPath &&
          (!i.projectPath ||
            i.scope === "user" ||
            (cwd && path.resolve(i.projectPath) === path.resolve(cwd)))
      );
    if (!install?.installPath) continue;
    const root = install.installPath;
    const manifest = readJson<PluginManifest>(
      path.join(root, ".claude-plugin", "plugin.json")
    );
    const prefix = `${manifest?.name || key.split("@")[0]}:`;

    const commandDirs = new Set([path.join(root, "commands")]);
    for (const p of asList(manifest?.commands)) {
      const full = path.resolve(root, p);
      if (full.endsWith(".md")) {
        const meta = readMeta(full);
        if (meta) {
          out.push({
            name: prefix + path.basename(full, ".md"),
            description: meta.description,
            source: "plugin",
          });
        }
      } else commandDirs.add(full);
    }
    for (const dir of commandDirs) {
      out.push(...scanCommands(dir, "plugin", prefix));
    }

    const skillDirs = new Set([
      path.join(root, "skills"),
      ...asList(manifest?.skills).map((p) => path.resolve(root, p)),
    ]);
    for (const dir of skillDirs) out.push(...scanSkills(dir, "plugin", prefix));
  }
  return out;
}

/** Skills synced from claude.ai, which Claude Code offers as anthropic-skills:* */
function scanSyncedSkills(): ClaudeCommand[] {
  const root = path.join(CLAUDE_DIR, "skills", "synced");
  return readDir(root)
    .filter((e) => e.isDirectory())
    .flatMap((e) =>
      scanSkills(path.join(root, e.name), "skill", "anthropic-skills:")
    );
}

/** First of each name wins, then sorted for a stable picker */
function tidy(list: ClaudeCommand[]): ClaudeCommand[] {
  const seen = new Set<string>();
  return list
    .filter((c) => !seen.has(c.name) && seen.add(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every open composer asks for this; a short TTL on top of the per-file
// mtime cache spares the directory walk when several ask at once
const LIST_TTL = 5_000;
const listCache = new Map<
  string,
  { at: number; groups: ClaudeCommandGroups }
>();

export function listClaudeCommands(cwd: string | null): ClaudeCommandGroups {
  const key = cwd ?? "";
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL) return hit.groups;

  const builtin: ClaudeCommand[] = BUILTINS.map(([name, description]) => ({
    name,
    description,
    source: "builtin",
  }));
  const skills = [
    ...scanSkills(path.join(CLAUDE_DIR, "skills"), "skill"),
    ...scanSyncedSkills(),
  ];
  const project = cwd
    ? [
        ...scanCommands(path.join(cwd, ".claude", "commands"), "project"),
        ...scanSkills(path.join(cwd, ".claude", "skills"), "project"),
      ]
    : [];

  const groups: ClaudeCommandGroups = {
    builtin: tidy(builtin),
    skills: tidy(skills),
    plugins: tidy(scanPlugins(cwd)),
    user: tidy(scanCommands(path.join(CLAUDE_DIR, "commands"), "user")),
    project: tidy(project),
  };
  if (listCache.size > 50) listCache.clear();
  listCache.set(key, { at: Date.now(), groups });
  return groups;
}
