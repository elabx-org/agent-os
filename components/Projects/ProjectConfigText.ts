/**
 * M3 (U3.3): pure helpers for the `.agent-os.json` editor: the file as the
 * editor holds it, script edits, the preview's line diff and JSON tokens.
 * No React, so tests/unit/config-preview.test.ts runs them directly.
 */

import type {
  AgentOsConfig,
  ProjectConfigResponse,
  ProjectScript,
} from "@/lib/project-config-types";

/** The file's text as the server writes it: 2-space JSON, a final newline */
export function serializeConfig(config: AgentOsConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * The file's own content, which edits start from. Not the response's
 * `config`: that has the legacy file's setup merged in, which mustn't be
 * written into `.agent-os.json` by an unrelated edit. Null when the file
 * isn't a JSON object (the editor then won't overwrite it).
 */
export function fileConfig(
  res: Pick<ProjectConfigResponse, "text">
): AgentOsConfig | null {
  if (!res.text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(res.text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AgentOsConfig)
      : null;
  } catch {
    return null;
  }
}

/** The file's scripts, each with an id (made from its name when missing) */
export function listScripts(config: AgentOsConfig): ProjectScript[] {
  const raw = Array.isArray(config.scripts) ? config.scripts : [];
  const taken = new Set<string>();
  return raw
    .filter(
      (s): s is ProjectScript =>
        !!s && typeof s === "object" && typeof s.command === "string"
    )
    .map((s) => {
      const id = s.id?.trim() ? s.id : scriptId(s.name || s.command, taken);
      taken.add(id);
      return { ...s, id, name: s.name || s.command };
    });
}

/** "Deploy to test server" → "deploy-to-test-server", unique among `taken` */
export function scriptId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "script";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * A script as written: known keys in a fixed order, defaults left out
 * (except `in`, which reads better spelled out), unknown keys kept
 */
export function cleanScript(script: ProjectScript): ProjectScript {
  const {
    id,
    name,
    command,
    icon,
    shortcut,
    in: runIn,
    onWorktree,
    ...rest
  } = script;
  const out: ProjectScript = { id, name: name.trim(), command: command.trim() };
  if (icon) out.icon = icon;
  if (shortcut) out.shortcut = shortcut;
  out.in = runIn === "background" ? "background" : "terminal";
  if (onWorktree) out.onWorktree = true;
  return { ...out, ...rest };
}

/** The config with `script` added, or replacing the one with `replaceId` */
export function upsertScript(
  config: AgentOsConfig,
  script: ProjectScript,
  replaceId?: string
): AgentOsConfig {
  const scripts = listScripts(config);
  const clean = cleanScript(script);
  const at = replaceId ? scripts.findIndex((s) => s.id === replaceId) : -1;
  const next =
    at >= 0
      ? scripts.map((s, i) => (i === at ? clean : s))
      : [...scripts, clean];
  return { ...config, scripts: next };
}

export function removeScript(config: AgentOsConfig, id: string): AgentOsConfig {
  const scripts = listScripts(config).filter((s) => s.id !== id);
  const { scripts: _drop, ...rest } = config;
  return scripts.length ? { ...rest, scripts } : rest;
}

/** The config with `key` set, or removed when `value` is empty */
export function setKey<K extends keyof AgentOsConfig>(
  config: AgentOsConfig,
  key: K,
  value: AgentOsConfig[K] | undefined
): AgentOsConfig {
  const next = { ...config };
  const empty =
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((v) => v === undefined || v === ""));
  if (empty) delete next[key];
  else next[key] = value;
  return next;
}

/** `defaults` with some fields changed; empty ones dropped */
export function withDefaults(
  config: AgentOsConfig,
  patch: NonNullable<AgentOsConfig["defaults"]>
): AgentOsConfig {
  const merged: Record<string, unknown> = { ...config.defaults, ...patch };
  for (const k of Object.keys(merged))
    if (merged[k] === undefined || merged[k] === "") delete merged[k];
  return setKey(
    config,
    "defaults",
    Object.keys(merged).length
      ? (merged as AgentOsConfig["defaults"])
      : undefined
  );
}

/**
 * The legacy file's setup steps (and dev server) moved into the file: what
 * the "Move to .agent-os.json" tap writes. The old file stays.
 */
export function mergeLegacy(
  config: AgentOsConfig,
  legacy: NonNullable<ProjectConfigResponse["legacy"]>
): AgentOsConfig {
  let next = config;
  if (legacy.setup?.length) next = setKey(next, "setup", [...legacy.setup]);
  if (legacy.devServer) next = setKey(next, "devServer", legacy.devServer);
  return next;
}

/** Whether `.agent-os.json` already holds the legacy file's steps */
export function legacyMoved(
  config: AgentOsConfig,
  legacy: NonNullable<ProjectConfigResponse["legacy"]>
): boolean {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (
    (!legacy.setup?.length || same(config.setup, legacy.setup)) &&
    (!legacy.devServer || same(config.devServer, legacy.devServer))
  );
}

/** Setup steps as entered in the editor: one per line, blanks dropped */
export function parseSteps(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A step's gist: "npm install --legacy-peer-deps" → "npm install" */
function gist(step: string): string {
  const words = step.trim().split(/\s+/);
  const first = words.slice(0, 2).join(" ");
  return first.length > 28 ? `${first.slice(0, 27)}…` : first;
}

/** The worktree toggle's subtitle: "After npm install and cp .env.example" */
export function setupSummary(steps: readonly string[] | undefined): string {
  const list = (steps ?? []).filter((s) => s.trim());
  if (!list.length) return "When the worktree is ready";
  if (list.length === 1) return `After ${gist(list[0])}`;
  if (list.length === 2) return `After ${gist(list[0])} and ${gist(list[1])}`;
  return `After ${gist(list[0])}, ${gist(list[1])} and ${list.length - 2} more`;
}

/** "2 steps", "1 step", "No steps" */
export function stepsLabel(n: number): string {
  if (!n) return "No steps";
  return `${n} step${n === 1 ? "" : "s"}`;
}

// ---- The preview ----

export interface DiffLine {
  text: string;
  /** Not in the base (on disk): drawn "+N" in green */
  added: boolean;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  /** Base lines that are gone */
  removed: number;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Above this many cells the LCS table is skipped for a multiset match */
const LCS_LIMIT = 4_000_000;

/**
 * `next`'s lines, those not in `base` marked added (a longest common
 * subsequence, so a moved line counts as added once and removed once)
 */
export function lineDiff(base: string, next: string): LineDiff {
  const a = splitLines(base);
  const b = splitLines(next);
  const keep = new Array<boolean>(b.length).fill(false);
  let common = 0;

  if (a.length * b.length <= LCS_LIMIT) {
    // dp[i][j]: LCS length of a[i..] and b[j..]
    const w = b.length + 1;
    const dp = new Uint32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        dp[i * w + j] =
          a[i] === b[j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        keep[j] = true;
        common++;
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  } else {
    const counts = new Map<string, number>();
    for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
    b.forEach((line, j) => {
      const n = counts.get(line) ?? 0;
      if (!n) return;
      counts.set(line, n - 1);
      keep[j] = true;
      common++;
    });
  }

  return {
    lines: b.map((text, j) => ({ text, added: !keep[j] })),
    added: b.length - common,
    removed: a.length - common,
  };
}

export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punct";

export interface JsonToken {
  text: string;
  kind: JsonTokenKind | null;
}

const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

/** One line of pretty JSON as tokens, for light highlighting */
export function jsonTokens(line: string): JsonToken[] {
  const out: JsonToken[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: line.slice(last, at), kind: null });
    if (m[1] !== undefined) {
      out.push({ text: m[1], kind: m[2] ? "key" : "string" });
      if (m[2]) out.push({ text: m[2], kind: "punct" });
    } else if (m[3] !== undefined) out.push({ text: m[3], kind: "number" });
    else if (m[4] !== undefined) out.push({ text: m[4], kind: "literal" });
    else out.push({ text: m[5], kind: "punct" });
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), kind: null });
  return out;
}

/** "3 lines to add", plus what goes when lines are removed */
export function diffChip(diff: Pick<LineDiff, "added" | "removed">): string {
  const parts: string[] = [];
  if (diff.added)
    parts.push(`${diff.added} line${diff.added === 1 ? "" : "s"} to add`);
  if (diff.removed)
    parts.push(
      diff.added
        ? `${diff.removed} to remove`
        : `${diff.removed} line${diff.removed === 1 ? "" : "s"} to remove`
    );
  return parts.join(" · ");
}

/** Two shortcut strings name the same keys ("cmd+shift+t" = "Cmd+Shift+T") */
export function sameShortcutText(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/ctrl|meta|command|⌘/g, "cmd")
      .split("+")
      .sort()
      .join("+");
  return norm(a) === norm(b);
}
