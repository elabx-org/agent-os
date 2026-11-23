/**
 * "Claude setup": the skills, commands, agents and plugins in a machine's
 * ~/.claude, and bringing a linked machine's in line with the server's
 * (Settings, Machines). Shared by both sides and the page; no Node here.
 *
 * Never part of it: sign-in, settings.json, MCP connections and their
 * keys, hooks, and the skills Claude itself syncs from the account
 * (~/.claude/skills/synced).
 */

export type SetupKind = "skill" | "command" | "agent" | "plugin";

/** One top-level entry: "skill:duo", "command:duo.md", "plugin:x@market" */
export interface SetupItem {
  key: string;
  kind: SetupKind;
  /** The folder or file name; a plugin's "name@marketplace" */
  name: string;
  /** sha256 of its files (skills, commands, agents); a plugin's version */
  hash: string;
  bytes: number;
  description?: string;
  /** It names tools only some machines have (an MCP server's) */
  usesTools?: boolean;
  /** A plugin's marketplace: its name and where Claude gets it from */
  marketplace?: { name: string; source: string };
}

/** What AgentOS itself put on this machine, and the user's choices */
export interface SetupRecord {
  /** key -> the hash it had when it was copied here */
  placed: Record<string, string>;
  /** Keep matching the server (this machine's owner turned it on) */
  follow: boolean;
  /** Keys the user unticked: never copied by "keep matching" */
  skip: string[];
}

export interface PluginResult {
  id: string;
  ok: boolean;
  message?: string;
}

/** The last copy onto this machine */
export interface SetupJob {
  state: "running" | "done" | "failed";
  at: number;
  copied: string[];
  /** Already here and not AgentOS's: left as they are */
  kept: string[];
  plugins: PluginResult[];
  pluginsLeft: number;
  error?: string;
}

export interface SetupInventory {
  items: SetupItem[];
  record: SetupRecord;
  job: SetupJob | null;
  /** false when `claude` isn't installed here */
  claude: boolean;
}

export type SetupState =
  /** The machine doesn't have it */
  | "missing"
  /** AgentOS copied an older one */
  | "update"
  /** Both have the same */
  | "same"
  /** The machine has its own, which AgentOS leaves alone */
  | "kept";

export interface SetupRow {
  item: SetupItem;
  state: SetupState;
}

export interface SetupDiff {
  /** The server's items, as they stand on the machine */
  rows: SetupRow[];
  /** On the machine only */
  own: SetupItem[];
}

export const SETUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._@ -]{0,119}$/;
export const SETUP_KEY =
  /^(skill|command|agent|plugin):[A-Za-z0-9][A-Za-z0-9._@ -]{0,119}$/;

export const setupKey = (kind: SetupKind, name: string) => `${kind}:${name}`;

/** The folder in ~/.claude a kind lives in; null for plugins */
export const SETUP_DIR: Record<SetupKind, string | null> = {
  skill: "skills",
  command: "commands",
  agent: "agents",
  plugin: null,
};

/**
 * Pure: how each of the server's items stands on a machine. A copy
 * AgentOS made that the machine's owner has since changed counts as the
 * owner's ("kept").
 */
export function setupDiff(
  hub: SetupItem[],
  machine: SetupItem[],
  placed: Record<string, string>
): SetupDiff {
  const there = new Map(machine.map((item) => [item.key, item]));
  const rows: SetupRow[] = hub.map((item) => {
    const mine = there.get(item.key);
    if (!mine) return { item, state: "missing" };
    // Claude keeps a plugin current itself: having it is enough
    if (item.kind === "plugin" || mine.hash === item.hash) {
      return { item, state: "same" };
    }
    return { item, state: placed[item.key] === mine.hash ? "update" : "kept" };
  });
  const known = new Set(hub.map((item) => item.key));
  return { rows, own: machine.filter((item) => !known.has(item.key)) };
}

/** What "keep matching" copies: missing or outdated, and not unticked */
export function followKeys(diff: SetupDiff, skip: string[]): string[] {
  const no = new Set(skip);
  return diff.rows
    .filter(
      (row) =>
        (row.state === "missing" || row.state === "update") &&
        !no.has(row.item.key)
    )
    .map((row) => row.item.key);
}

/** "11 skills, 14 plugins and 3 commands" */
export function countSentence(items: Pick<SetupItem, "kind">[]): string {
  const order: [SetupKind, string][] = [
    ["skill", "skill"],
    ["plugin", "plugin"],
    ["command", "command"],
    ["agent", "agent"],
  ];
  const parts = order
    .map(([kind, word]) => {
      const n = items.filter((item) => item.kind === kind).length;
      return n ? `${n} ${word}${n === 1 ? "" : "s"}` : "";
    })
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** For the page: an item as "duo" or "superpowers" */
export const shortName = (item: Pick<SetupItem, "kind" | "name">) =>
  item.kind === "plugin"
    ? item.name.split("@")[0]
    : item.name.replace(/\.md$/, "");
