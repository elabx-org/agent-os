/**
 * What this machine's ~/.claude holds (lib/claude-setup/types.ts), and
 * the record of what AgentOS copied here. Server only.
 */

import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { claudeDir } from "../claude-transcript";
import { parseFrontmatter } from "../frontmatter";
import { home } from "../link/secrets";
import {
  SETUP_DIR,
  SETUP_KEY,
  SETUP_NAME,
  setupKey,
  type SetupInventory,
  type SetupItem,
  type SetupJob,
  type SetupKind,
  type SetupRecord,
} from "./types";

/** Claude's own copies of the account's skills: it keeps those in step */
const CLAUDE_OWNED = new Set(["synced"]);

export const recordPath = () => path.join(home(), "claude-setup.json");

export function readRecord(file = recordPath()): SetupRecord {
  try {
    const raw = JSON.parse(
      fs.readFileSync(file, "utf8")
    ) as Partial<SetupRecord>;
    const placed: Record<string, string> = {};
    for (const [key, hash] of Object.entries(raw.placed ?? {})) {
      if (SETUP_KEY.test(key) && typeof hash === "string") placed[key] = hash;
    }
    return {
      placed,
      follow: raw.follow === true,
      skip: Array.isArray(raw.skip)
        ? raw.skip.filter(
            (k): k is string => typeof k === "string" && SETUP_KEY.test(k)
          )
        : [],
    };
  } catch {
    return { placed: {}, follow: false, skip: [] };
  }
}

export function writeRecord(record: SetupRecord, file = recordPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * sha256 over every file's path and bytes (and each link's target), in
 * name order, so the same files hash the same on any machine
 */
export function hashEntry(root: string): { hash: string; bytes: number } {
  const sum = createHash("sha256");
  let bytes = 0;
  const walk = (full: string, rel: string) => {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      sum.update(`l\0${rel}\0${fs.readlinkSync(full)}\0`);
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (name === ".DS_Store") continue;
        walk(path.join(full, name), rel ? `${rel}/${name}` : name);
      }
    } else if (stat.isFile()) {
      const data = fs.readFileSync(full);
      bytes += data.length;
      sum.update(`f\0${rel}\0${data.length}\0`);
      sum.update(data);
    }
  };
  walk(root, "");
  return { hash: sum.digest("hex").slice(0, 32), bytes };
}

function describe(kind: SetupKind, full: string): Partial<SetupItem> {
  try {
    let file = full;
    if (fs.statSync(full).isDirectory()) {
      const names = fs.readdirSync(full);
      const pick =
        names.find((n) => n === "SKILL.md") ??
        names.find((n) => n.endsWith(".md"));
      if (!pick) return {};
      file = path.join(full, pick);
    }
    const text = fs.readFileSync(file, "utf8").slice(0, 200_000);
    const description = parseFrontmatter(text)
      .metadata.description?.replace(/^["']|["']$/g, "")
      .slice(0, 160);
    return {
      description: description || undefined,
      usesTools:
        kind === "skill" && /\bmcp__[a-z]/i.test(text) ? true : undefined,
    };
  } catch {
    return {};
  }
}

function entries(
  kind: Exclude<SetupKind, "plugin">,
  root: string
): SetupItem[] {
  const dir = path.join(root, SETUP_DIR[kind]!);
  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out: SetupItem[] = [];
  for (const name of names) {
    if (name.startsWith(".") || !SETUP_NAME.test(name)) continue;
    if (kind === "skill" && CLAUDE_OWNED.has(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.lstatSync(full);
      // A linked skill is the owner's own arrangement: not ours to copy
      if (stat.isSymbolicLink()) continue;
      if (kind === "skill" && !stat.isDirectory()) continue;
      if (!stat.isDirectory() && !stat.isFile()) continue;
      out.push({
        key: setupKey(kind, name),
        kind,
        name,
        ...hashEntry(full),
        ...describe(kind, full),
      });
    } catch {
      // Unreadable: not listed
    }
  }
  return out;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function sourceText(source: unknown): string | null {
  const s = source as { source?: string; repo?: string; url?: string } | null;
  if (s?.source === "github" && typeof s.repo === "string") {
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.repo) ? s.repo : null;
  }
  if (typeof s?.url === "string" && /^https:\/\/[^\s]+$/.test(s.url))
    return s.url;
  return null;
}

/** The user's installed, enabled plugins that come from a marketplace */
function plugins(root: string): SetupItem[] {
  const installed = readJson<{
    plugins?: Record<string, { scope?: string; version?: string }[]>;
  }>(path.join(root, "plugins", "installed_plugins.json"));
  const markets =
    readJson<Record<string, { source?: unknown }>>(
      path.join(root, "plugins", "known_marketplaces.json")
    ) ?? {};
  const enabled =
    readJson<{ enabledPlugins?: Record<string, boolean> }>(
      path.join(root, "settings.json")
    )?.enabledPlugins ?? {};
  const out: SetupItem[] = [];
  for (const [id, copies] of Object.entries(installed?.plugins ?? {})) {
    if (!SETUP_NAME.test(id) || enabled[id] === false) continue;
    const copy = copies.find((c) => c.scope === "user");
    const market = id.split("@")[1];
    const source = market ? sourceText(markets[market]?.source) : null;
    if (!copy || !market || !source) continue;
    out.push({
      key: setupKey("plugin", id),
      kind: "plugin",
      name: id,
      hash: String(copy.version ?? ""),
      bytes: 0,
      marketplace: { name: market, source },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Where `claude` is on this machine, or null */
export function claudeBinary(): string | null {
  const dirs = [
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(path.delimiter),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const file = path.join(dir, "claude");
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // Not there
    }
  }
  return null;
}

const shared = globalThis as typeof globalThis & {
  __agentosSetupJob?: SetupJob | null;
};
export const setupJob = () => shared.__agentosSetupJob ?? null;
export const setSetupJob = (job: SetupJob | null) => {
  shared.__agentosSetupJob = job;
};

export function listItems(root = claudeDir()): SetupItem[] {
  return [
    ...entries("skill", root),
    ...plugins(root),
    ...entries("command", root),
    ...entries("agent", root),
  ];
}

export function inventory(): SetupInventory {
  return {
    items: listItems(),
    record: readRecord(),
    job: setupJob(),
    claude: claudeBinary() !== null,
  };
}
