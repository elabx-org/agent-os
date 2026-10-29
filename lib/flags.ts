/**
 * Feature flags: kill switches for background work and risky behaviour,
 * stored in preferences (key "flags", JSON) and mirrored to
 * $AGENT_OS_HOME/flags.json for the Claude hook scripts.
 * AGENTOS_DISABLE_TICKERS=1 forces every ticker off.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { getDb, queries } from "./db";
import {
  FLAG_DEFAULTS,
  FLAG_NAMES,
  FLAGS_PREFERENCE_KEY,
  TICKER_FLAGS,
  parseFlags,
  type FlagName,
  type Flags,
} from "./flag-names";

export {
  FLAG_DEFAULTS,
  FLAG_LABELS,
  FLAG_NAMES,
  FLAGS_PREFERENCE_KEY,
  TICKER_FLAGS,
  parseFlags,
  type FlagName,
  type Flags,
} from "./flag-names";

const CACHE_MS = 5000;

// On globalThis: server.ts (tickers) and the API routes (Next's bundle) load
// separate copies of this module, and a change from Labs must reach both
const shared = globalThis as unknown as {
  __agentosFlags?: { flags: Flags; at: number };
  /** The JSON last written to flags.json, so it is only rewritten on change */
  __agentosFlagsMirror?: string;
};

export function tickersDisabled(): boolean {
  return process.env.AGENTOS_DISABLE_TICKERS === "1";
}

/** The stored flags as they apply here: tickers off when disabled by env */
export function effectiveFlags(stored: Flags, disabled: boolean): Flags {
  if (!disabled) return stored;
  const flags = { ...stored };
  for (const name of TICKER_FLAGS) flags[name] = false;
  return flags;
}

export function flagsMirrorFile(): string {
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "flags.json");
}

function readStored(): Flags {
  const row = queries.getPreference(getDb()).get(FLAGS_PREFERENCE_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...FLAG_DEFAULTS };
  try {
    return parseFlags(JSON.parse(row.value));
  } catch {
    return { ...FLAG_DEFAULTS };
  }
}

/** Writes flags.json when it changed; the hooks read it with no DB access */
function mirror(flags: Flags): void {
  const json = JSON.stringify(flags, null, 2) + "\n";
  if (shared.__agentosFlagsMirror === json) return;
  try {
    const file = flagsMirrorFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Renamed into place, so a hook never reads half a file
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, json, { mode: 0o600 });
    fs.renameSync(tmp, file);
    shared.__agentosFlagsMirror = json;
  } catch (error) {
    console.error("Failed to write flags.json:", error);
  }
}

/** All flags, through a 5s cache shared by server.ts and Next */
export function getFlags(): Flags {
  const cached = shared.__agentosFlags;
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.flags };

  let flags: Flags;
  try {
    flags = effectiveFlags(readStored(), tickersDisabled());
  } catch (error) {
    // Unreadable flags fail safe: everything off
    console.error("Failed to read flags:", error);
    flags = { ...FLAG_DEFAULTS };
  }
  shared.__agentosFlags = { flags, at: Date.now() };
  mirror(flags);
  return { ...flags };
}

export function getFlag(name: FlagName): boolean {
  return getFlags()[name];
}

/** Saves a change, refreshes the cache and the flags.json mirror */
export function setFlags(patch: Partial<Flags>): Flags {
  for (const [name, value] of Object.entries(patch)) {
    if (!(FLAG_NAMES as readonly string[]).includes(name)) {
      throw new TypeError(`Unknown flag: ${name}`);
    }
    if (typeof value !== "boolean") {
      throw new TypeError(`Flag ${name} must be true or false`);
    }
  }
  const db = getDb();
  db.transaction(() => {
    const next = { ...readStored(), ...patch };
    queries
      .upsertPreference(db)
      .run(FLAGS_PREFERENCE_KEY, JSON.stringify(next));
  })();
  shared.__agentosFlags = undefined;
  return getFlags();
}
