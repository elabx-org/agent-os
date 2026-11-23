/**
 * Both ends of a copy of the server's Claude setup (lib/claude-setup):
 * the server packs the chosen skills, commands and agents into one
 * tar.gz with a setup.json naming the plugins; the machine checks every
 * path, puts each entry in place unless its owner has their own, and has
 * Claude install the plugins itself. Nothing is ever deleted, and an
 * entry AgentOS didn't put there (or that was changed since) is left
 * alone. Server only.
 */

import { execFile, spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { claudeDir } from "../claude-transcript";
import {
  claudeBinary,
  hashEntry,
  listItems,
  readRecord,
  recordPath,
  setSetupJob,
  setupJob,
  writeRecord,
} from "./inventory";
import {
  SETUP_DIR,
  SETUP_KEY,
  SETUP_NAME,
  setupKey,
  type PluginResult,
  type SetupJob,
  type SetupKind,
} from "./types";

/** Everything the server sends in one copy */
export const PACK_MAX = 400 * 1024 * 1024;
const PLUGIN_MS = 5 * 60_000;

export interface PackNote {
  /** The server's name, for messages */
  from: string;
  plugins: { id: string; marketplace: { name: string; source: string } }[];
}

export class SetupRefused extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const FILE_KINDS = ["skill", "command", "agent"] as const;
const DIR_KIND = new Map<string, SetupKind>(
  FILE_KINDS.map((kind) => [SETUP_DIR[kind]!, kind])
);

/** The server: a tar.gz of these of its own items, plugins as a list */
export async function packSetup(
  keys: string[],
  from: string,
  root = claudeDir()
): Promise<{ stream: Readable; done: Promise<void> }> {
  const wanted = new Set(keys.filter((key) => SETUP_KEY.test(key)));
  const items = listItems(root).filter((item) => wanted.has(item.key));
  const note: PackNote = {
    from,
    plugins: items
      .filter((item) => item.kind === "plugin" && item.marketplace)
      .map((item) => ({ id: item.name, marketplace: item.marketplace! })),
  };
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "agentos-setup-"));
  await fsp.writeFile(path.join(tmp, "setup.json"), JSON.stringify(note));
  const paths = items
    .filter((item) => item.kind !== "plugin")
    .map((item) => `${SETUP_DIR[item.kind]}/${item.name}`);
  const args = ["-czf", "-", "-C", tmp, "setup.json"];
  if (paths.length) args.push("-C", root, ...paths);
  const child = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += String(chunk).slice(0, 2000)));
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      void fsp.rm(tmp, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new Error(`tar failed (${code}): ${stderr.trim()}`));
    });
  });
  // The caller pipes the stream; a failed tar ends it early and `done` says why
  done.catch(() => {});
  return { stream: child.stdout, done };
}

function run(
  file: string,
  args: string[],
  timeout = 120_000
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, maxBuffer: 32 * 1024 * 1024, env: process.env },
      (error, stdout, stderr) =>
        resolve({ ok: !error, out: `${stdout}\n${stderr}`.trim() })
    );
  });
}

/** Pure: a path inside the pack is one we take, or null */
export function packPath(
  name: string
): { kind: SetupKind; entry: string } | "note" | "dir" | null {
  const clean = name.replace(/\/+$/, "");
  if (clean === "setup.json") return "note";
  if (name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
    return null;
  }
  const parts = clean.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  const kind = DIR_KIND.get(parts[0]);
  if (!kind) return null;
  if (parts.length === 1) return "dir";
  return SETUP_NAME.test(parts[1]) ? { kind, entry: parts[1] } : null;
}

/** Every link in an entry points inside that entry */
function linksStayInside(root: string): boolean {
  const base = fs.realpathSync(root);
  const walk = (full: string): boolean => {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      const target = path.resolve(path.dirname(full), fs.readlinkSync(full));
      return target === base || target.startsWith(base + path.sep);
    }
    if (stat.isDirectory()) {
      return fs.readdirSync(full).every((name) => walk(path.join(full, name)));
    }
    return stat.isFile();
  };
  return walk(root);
}

function validNote(value: unknown): PackNote {
  const note = value as Partial<PackNote> | null;
  const plugins = Array.isArray(note?.plugins) ? note.plugins : [];
  return {
    from:
      typeof note?.from === "string" ? note.from.slice(0, 60) : "the server",
    plugins: plugins.filter(
      (p) =>
        typeof p?.id === "string" &&
        SETUP_NAME.test(p.id) &&
        p.id.includes("@") &&
        typeof p.marketplace?.name === "string" &&
        p.id.endsWith(`@${p.marketplace.name}`) &&
        typeof p.marketplace.source === "string" &&
        /^(https:\/\/[^\s]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.test(
          p.marketplace.source
        )
    ),
  };
}

export interface InstallDeps {
  root?: string;
  record?: string;
  /** Runs `claude` with these arguments */
  claude?: (args: string[]) => Promise<{ ok: boolean; out: string }>;
  /** Tests wait for the plugins too */
  waitForPlugins?: boolean;
}

const lastLine = (text: string) =>
  text.split("\n").filter(Boolean).pop()?.slice(0, 200) ?? "";

async function installPlugins(
  note: PackNote,
  job: SetupJob,
  deps: InstallDeps
): Promise<void> {
  const root = deps.root ?? claudeDir();
  const binary = claudeBinary();
  const claude =
    deps.claude ??
    (binary ? (args: string[]) => run(binary, args, PLUGIN_MS) : null);
  for (const plugin of note.plugins) {
    let result: PluginResult;
    const has = () =>
      listItems(root).some((i) => i.key === setupKey("plugin", plugin.id));
    if (has()) {
      result = { id: plugin.id, ok: true, message: "Already installed" };
    } else if (!claude) {
      result = {
        id: plugin.id,
        ok: false,
        message: "Claude isn't installed here",
      };
    } else {
      let known: Record<string, unknown> = {};
      try {
        known = JSON.parse(
          fs.readFileSync(
            path.join(root, "plugins", "known_marketplaces.json"),
            "utf8"
          )
        );
      } catch {
        // None yet
      }
      let added = { ok: true, out: "" };
      if (!known[plugin.marketplace.name]) {
        added = await claude([
          "plugin",
          "marketplace",
          "add",
          plugin.marketplace.source,
        ]);
      }
      // No -y: a plugin that wants to run a command to install itself is
      // left for the owner to install by hand
      const done = added.ok
        ? await claude(["plugin", "install", plugin.id, "--scope", "user"])
        : added;
      result = done.ok
        ? { id: plugin.id, ok: true }
        : { id: plugin.id, ok: false, message: lastLine(done.out) };
    }
    job.plugins.push(result);
    job.pluginsLeft -= 1;
  }
}

/**
 * The machine: takes a pack in. Answers once the files are in place; the
 * plugins carry on, and the job (GET /api/claude-setup) says how far
 */
export async function installSetup(
  body: Readable,
  deps: InstallDeps = {}
): Promise<SetupJob> {
  if (setupJob()?.state === "running") {
    throw new SetupRefused("A copy is already running on this machine", 409);
  }
  const root = deps.root ?? claudeDir();
  const recordFile = deps.record ?? recordPath();
  const job: SetupJob = {
    state: "running",
    at: Date.now(),
    copied: [],
    kept: [],
    plugins: [],
    pluginsLeft: 0,
  };
  setSetupJob(job);
  await fsp.mkdir(root, { recursive: true });
  const work = await fsp.mkdtemp(path.join(root, ".agentos-incoming-"));
  const finish = (error?: unknown) => {
    job.state = error ? "failed" : "done";
    if (error)
      job.error = error instanceof Error ? error.message : String(error);
  };
  try {
    const file = path.join(work, "pack.tgz");
    let size = 0;
    await pipeline(
      body,
      async function* (source) {
        for await (const chunk of source) {
          size += (chunk as Buffer).length;
          if (size > PACK_MAX)
            throw new SetupRefused("That copy is too large", 413);
          yield chunk;
        }
      },
      fs.createWriteStream(file)
    );
    const listed = await run("tar", ["-tzf", file]);
    if (!listed.ok) throw new SetupRefused("That isn't a copy AgentOS made");
    const names = listed.out.split("\n").filter(Boolean);
    const found = new Map<string, { kind: SetupKind; entry: string }>();
    for (const name of names) {
      const at = packPath(name);
      if (!at)
        throw new SetupRefused(`The copy holds a path it shouldn't: ${name}`);
      if (typeof at === "object") found.set(setupKey(at.kind, at.entry), at);
    }
    const out = path.join(work, "out");
    await fsp.mkdir(out);
    const extracted = await run("tar", ["-xzf", file, "-C", out]);
    if (!extracted.ok) throw new SetupRefused("The copy couldn't be unpacked");
    const note = validNote(
      JSON.parse(await fsp.readFile(path.join(out, "setup.json"), "utf8"))
    );
    const record = readRecord(recordFile);
    let n = 0;
    for (const [key, at] of found) {
      const dir = SETUP_DIR[at.kind]!;
      const incoming = path.join(out, dir, at.entry);
      if (!fs.existsSync(incoming)) continue;
      if (!linksStayInside(incoming)) {
        throw new SetupRefused(`${at.entry} links outside itself`);
      }
      const target = path.join(root, dir, at.entry);
      const hash = hashEntry(incoming).hash;
      let there: fs.Stats | null = null;
      try {
        there = fs.lstatSync(target);
      } catch {
        // Not here yet
      }
      if (there) {
        const mine = there.isSymbolicLink() ? null : hashEntry(target).hash;
        if (mine === hash) {
          // The same already: nothing to do, and not ours unless it was
          continue;
        }
        if (mine === null || record.placed[key] !== mine) {
          job.kept.push(key);
          continue;
        }
        await fsp.rename(target, path.join(work, `old-${n++}`));
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rename(incoming, target);
      record.placed[key] = hash;
      job.copied.push(key);
      writeRecord(record, recordFile);
    }
    job.pluginsLeft = note.plugins.length;
    const plugins = installPlugins(note, job, deps).then(
      () => finish(),
      (error) => finish(error)
    );
    if (deps.waitForPlugins) await plugins;
    return job;
  } catch (error) {
    finish(error);
    throw error;
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
