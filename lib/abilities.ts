/**
 * Finding what this machine can do (lib/abilities-types.ts), keeping the
 * user's note about it, and remembering what the machines linked with it
 * said about themselves. Server only.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import {
  ABILITY_IDS,
  cleanAbilities,
  cleanNotes,
  type Abilities,
  type AbilitiesView,
  type AbilityId,
} from "./abilities-types";
import { home as agentOsHome } from "./link/secrets";

const FRESH_MS = 10 * 60_000;
const PROBE_MS = 15_000;

/*
 * One login shell (the PATH a session gets) runs every check; each prints
 * a marker line, then whatever the tool said. Docker is last: it can hang
 * on a daemon that doesn't answer, and what came before is still read.
 */
const SCRIPT = `
p() { echo "@@$1"; shift; "$@" 2>&1 | head -n 40; }
p macos sw_vers -productVersion
p xcode xcodebuild -version
p swift swift --version
p simulator xcrun simctl list runtimes
p node node --version
p python python3 --version
p gh gh --version
p docker docker version --format '{{.Server.Version}}'
`;

const READ: Record<AbilityId | "macos", RegExp> = {
  macos: /^(\d+(?:\.\d+)*)\s*$/m,
  xcode: /Xcode (\d+(?:\.\d+)*)/,
  swift: /Swift version (\d+(?:\.\d+)*)/,
  simulator: /^iOS (\d+(?:\.\d+)*)/gm,
  node: /^v(\d+\.\d+)\.\d+/m,
  python: /Python (\d+\.\d+(?:\.\d+)?)/,
  gh: /gh version (\d+\.\d+(?:\.\d+)?)/,
  docker: /^(\d+\.\d+(?:\.\d+)*)\s*$/m,
};

/** What the checks printed, as abilities: exported for its test */
export function readProbe(
  out: string,
  platform: NodeJS.Platform,
  arch: string,
  now: number
): Abilities {
  const said = new Map<string, string>();
  for (const part of out.split(/^@@/m).slice(1)) {
    const end = part.indexOf("\n");
    if (end > 0) said.set(part.slice(0, end).trim(), part.slice(end + 1));
  }
  const pick = (key: AbilityId | "macos"): string | null => {
    const text = said.get(key);
    if (!text) return null;
    const re = READ[key];
    if (!re.global) return re.exec(text)?.[1] ?? null;
    // The newest runtime: the list is oldest first
    const all = [...text.matchAll(re)];
    return all.length ? all[all.length - 1][1] : null;
  };
  const found: Abilities["found"] = [];
  for (const id of ABILITY_IDS) {
    const version = pick(id);
    if (version) found.push({ id, version });
  }
  const os =
    platform === "darwin"
      ? "macOS"
      : platform === "linux"
        ? "Linux"
        : platform === "win32"
          ? "Windows"
          : "Other";
  return {
    os,
    osVersion: os === "macOS" ? pick("macos") : null,
    arch: arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : "other",
    found,
    at: now,
  };
}

function probe(): Promise<string> {
  const shell =
    process.env.SHELL ||
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-lc", SCRIPT],
      { timeout: PROBE_MS, maxBuffer: 1024 * 1024, env: process.env },
      // A check that hung or a shell that failed: what was printed still counts
      (_error, stdout) => resolve(typeof stdout === "string" ? stdout : "")
    );
  });
}

const shared = globalThis as unknown as {
  __agentosAbilities?: {
    value: Abilities | null;
    pending: Promise<Abilities> | null;
  };
};
const memo = (shared.__agentosAbilities ??= { value: null, pending: null });

/** What this machine can do, checked at most every ten minutes */
export function abilities(fresh = false): Promise<Abilities> {
  if (!fresh && memo.value && Date.now() - memo.value.at < FRESH_MS) {
    return Promise.resolve(memo.value);
  }
  if (memo.pending) return memo.pending;
  if (process.env.AGENTOS_FAKE_ABILITIES) {
    // The test rig says what each of its machines is
    const fake = cleanAbilities(JSON.parse(process.env.AGENTOS_FAKE_ABILITIES));
    if (fake) {
      memo.value = { ...fake, at: Date.now() };
      return Promise.resolve(memo.value);
    }
  }
  memo.pending = probe()
    .then((out) => {
      memo.value = readProbe(out, process.platform, process.arch, Date.now());
      return memo.value;
    })
    .finally(() => {
      memo.pending = null;
    });
  return memo.pending;
}

/** The last check, without waiting for one */
export const abilitiesNow = (): Abilities | null => memo.value;

// --- The user's note, and what the other machines said ---

const notesFile = () => path.join(agentOsHome(), "abilities.json");
const peersFile = () => path.join(agentOsHome(), "peer-abilities.json");

function readJson(file: string): Record<string, unknown> {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export const abilityNotes = (): string =>
  cleanNotes(readJson(notesFile()).notes) ?? "";

export function setAbilityNotes(notes: string): void {
  writeJson(notesFile(), { notes: cleanNotes(notes) ?? "" });
}

/** What a linked machine (or "hub") last said it can do */
export function peerAbilities(id: string): Abilities | null {
  return cleanAbilities(readJson(peersFile())[id]);
}

export function setPeerAbilities(id: string, value: Abilities): void {
  writeJson(peersFile(), { ...readJson(peersFile()), [id]: value });
}

export type Peer = AbilitiesView["peers"][number];
