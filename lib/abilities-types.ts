/**
 * What a machine can do: the tools AgentOS found on it (Xcode, Docker…).
 * Shown in Settings, Machines and told to each session when it starts, so
 * a chat knows an iOS build can't run on a Linux server. Everything a
 * linked machine says about itself passes cleanAbilities: ids and systems
 * from fixed lists and versions of digits and dots, since the text ends up
 * in other sessions' instructions. Safe for the client.
 */

export const ABILITY_LABELS = {
  xcode: "Xcode",
  swift: "Swift",
  simulator: "iOS simulator",
  docker: "Docker",
  node: "Node",
  python: "Python",
  gh: "GitHub CLI",
} as const;

export type AbilityId = keyof typeof ABILITY_LABELS;

export const ABILITY_IDS = Object.keys(ABILITY_LABELS) as AbilityId[];

/** Worth saying when missing: what decides where a job can run */
const NOTABLE: AbilityId[] = ["xcode", "simulator", "docker"];

const SYSTEMS = ["macOS", "Linux", "Windows", "Other"] as const;
const CHIPS = ["arm64", "x64", "other"] as const;

export interface Abilities {
  os: (typeof SYSTEMS)[number];
  osVersion: string | null;
  arch: (typeof CHIPS)[number];
  found: { id: AbilityId; version: string | null }[];
  /** When it was checked */
  at: number;
}

/** GET /api/abilities */
export interface AbilitiesView {
  name: string;
  abilities: Abilities;
  /** The user's own note about this machine */
  notes: string;
  /** The other machines it is linked with, as last heard */
  peers: { id: string; name: string; abilities: Abilities | null }[];
}

export const NOTES_MAX = 400;

const VERSION = /^[0-9][0-9A-Za-z.+-]{0,23}$/;

const version = (value: unknown): string | null =>
  typeof value === "string" && VERSION.test(value) ? value : null;

/** What a machine said about itself, or null when it isn't that */
export function cleanAbilities(value: unknown): Abilities | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const os = SYSTEMS.find((s) => s === v.os);
  const arch = CHIPS.find((c) => c === v.arch);
  if (!os || !arch || !Array.isArray(v.found)) return null;
  const found: Abilities["found"] = [];
  for (const item of v.found.slice(0, 40)) {
    if (!item || typeof item !== "object") return null;
    const id = ABILITY_IDS.find((a) => a === (item as { id?: unknown }).id);
    if (!id || found.some((f) => f.id === id)) continue;
    found.push({
      id,
      version: version((item as { version?: unknown }).version),
    });
  }
  return {
    os,
    osVersion: version(v.osVersion),
    arch,
    found,
    at: typeof v.at === "number" && Number.isFinite(v.at) ? v.at : 0,
  };
}

/** The user's note: one line, of a size that fits a session's instructions */
export function cleanNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim().slice(0, NOTES_MAX);
}

/** "macOS 26.1, Apple silicon" */
export function systemText(a: Abilities): string {
  const chip =
    a.arch === "arm64"
      ? a.os === "macOS"
        ? "Apple silicon"
        : "ARM"
      : a.arch === "x64"
        ? a.os === "macOS"
          ? "Intel"
          : "x86-64"
        : null;
  return [a.osVersion ? `${a.os} ${a.osVersion}` : a.os, chip]
    .filter(Boolean)
    .join(", ");
}

/** "Xcode 27.2, Swift 6.4, iOS simulator 27.1", in the list's order */
export function foundText(a: Abilities): string {
  return ABILITY_IDS.flatMap((id) => {
    const hit = a.found.find((f) => f.id === id);
    if (!hit) return [];
    return [`${ABILITY_LABELS[id]}${hit.version ? ` ${hit.version}` : ""}`];
  }).join(", ");
}

/** The ones that decide where a job runs and aren't here: "Xcode, Docker" */
export function missingText(a: Abilities): string {
  return NOTABLE.filter((id) => !a.found.some((f) => f.id === id))
    .map((id) => ABILITY_LABELS[id])
    .join(", ");
}

/** One short line for a row or a sheet: "Xcode 27.2 and iOS simulator 27.1 · no Docker" */
export function shortText(a: Abilities): string {
  const has = NOTABLE.flatMap((id) => {
    const hit = a.found.find((f) => f.id === id);
    if (!hit) return [];
    return [`${ABILITY_LABELS[id]}${hit.version ? ` ${hit.version}` : ""}`];
  });
  const missing = missingText(a);
  return [
    has.length ? has.join(", ") : null,
    missing ? `no ${missing.replace(/, /g, ", no ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A place a session can go, in the sheet that sends it: "Ready · Xcode 27.2 · no Docker" */
export function readyText(a: Abilities | null): string {
  const can = a ? shortText(a) : "";
  return can ? `Ready · ${can}` : "Ready";
}

/** A machine's name as it may appear in a session's instructions */
const plainName = (name: string): string =>
  name
    .replace(/["\n\r\\]/g, "")
    .trim()
    .slice(0, 60) || "a machine";

/**
 * The part of a session's starting note about its machine and the others
 * linked with it; null when there is nothing to compare it with
 */
export function machineSection(
  view: AbilitiesView,
  /** Whether sessions here can hand a job to another machine (run_job) */
  jobs = false
): string | null {
  if (view.peers.length === 0) return null;
  const mine = view.abilities;
  const missing = missingText(mine);
  const lines = [
    `## The machine you run on`,
    "",
    `This session runs on "${plainName(view.name)}" (${systemText(mine)}). AgentOS found here: ${foundText(mine) || "none of the tools it looks for"}.${missing ? ` Not found here: ${missing}.` : ""}`,
  ];
  if (view.notes) {
    lines.push("", `The user's note about this machine: ${view.notes}`);
  }
  lines.push("", "The user's other machines linked in AgentOS:", "");
  for (const peer of view.peers) {
    const a = peer.abilities;
    if (!a) {
      lines.push(`- "${plainName(peer.name)}": not checked yet.`);
      continue;
    }
    const lacks = missingText(a);
    lines.push(
      `- "${plainName(peer.name)}" (${systemText(a)}): ${foundText(a) || "none of the tools AgentOS looks for"}.${lacks ? ` Not found there: ${lacks}.` : ""}`
    );
  }
  lines.push(
    "",
    jobs
      ? `When a task needs something this machine lacks and another has (an iOS build or the simulator needs Xcode, say), don't work around it silently and don't assume it can't be done: hand that piece to the machine that has it with the run_job tool, and say in your reply which machine you sent it to and why. Your chat stays here; the machine gets your code as it is now, unsaved files included, and its result comes back to you. When the user writes @ and a machine's name, that is their say-so to run that request there with run_job. If the machine refuses (the user hasn't allowed it, or it is off), tell the user what it said. To move the whole chat instead, the user picks "Work on" and the machine's name in AgentOS. This list was checked when this session started.`
      : `When a task needs something this machine lacks and another has (an iOS build or the simulator needs Xcode, say), don't work around it silently and don't assume it can't be done: tell the user which machine has it. They can move this chat there in AgentOS with "Work on" and the machine's name. This list was checked when this session started.`
  );
  return lines.join("\n");
}
