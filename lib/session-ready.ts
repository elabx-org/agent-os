/**
 * Whether a session can take a message now. Fails closed: any screen it
 * can't classify is not ready. Used by the dispatcher (twice in a row, and
 * again right before the paste) and GET /queue.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { Session } from "./db";
import type { HoldReason } from "./queue/types";
import { readClaudeState, type ClaudeState } from "./claude-state";
import { readClaudeScreen } from "./claude-screen";
import { parsePermissionPrompt } from "./permission-prompt";
import {
  checkBusyIndicators,
  checkWaitingPatterns,
  statusDetector,
  type SessionStatus,
} from "./status-detector";
import { tmuxNameOf } from "./session-launch";
import { limitStateOf } from "./limits/types";
import { getFlags } from "./flags";
import { latest } from "./session-watch";
import { isHandingOff } from "./handing-off";

const execFileAsync = promisify(execFile);

export interface Readiness {
  ready: boolean;
  /** Null exactly when ready */
  holdReason: HoldReason | null;
}

const READY: Readiness = { ready: true, holdReason: null };
const hold = (holdReason: HoldReason): Readiness => ({
  ready: false,
  holdReason,
});

/** What classifyScreen reads, so it can be tested on recorded screens */
export interface ScreenInput {
  agentType: string;
  /** `capture-pane -p -e`: the pane's lines with their SGR escapes */
  lines: readonly string[];
  width: number;
  /** #{pane_in_mode}: copy or view mode would swallow the paste */
  paneInMode: boolean;
  /** Claude: what its hooks recorded */
  claude?: Pick<ClaudeState, "busy" | "pendingPermission"> | null;
  /** The others: the watched (or detected) status */
  status?: SessionStatus | null;
}

const ESCAPE =
  /\x1b(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

const ESCAPE_AT = new RegExp(ESCAPE.source, "y");

export function stripAnsi(line: string): string {
  return line.replace(ESCAPE, "");
}

/**
 * Claude's dialogs that take over the input: AskUserQuestion, plan
 * approval (ExitPlanMode), the folder trust screen, the /resume and /model
 * pickers. Matched on the bottom of the screen only, so an old one in the
 * scrollback doesn't count
 */
const CLAUDE_DIALOGS = [
  /Enter to select.*to navigate/i,
  /Would you like to proceed\?/i,
  /Ready to code\?/i,
  /trust (the files in |the contents of )?this (folder|directory|project)/i,
  /Is this a project you created or one you trust/i,
  /^\s*Resume Session\b/m,
  /^\s*Select model\b/m,
  /Switch between Claude models/i,
];

/** Codex and Gemini approval and trust screens */
const AGENT_DIALOGS = [
  /Allow command\?/i,
  /Would you like to (run the following command|make the following edits)\?/i,
  /Allow execution/i,
  /Apply this change\?/i,
  /Waiting for user confirmation/i,
  /Allow once/i,
  /trust (the files in |the contents of )?this (folder|directory|project)/i,
  /Allow Codex to work in this folder/i,
];

const COMPACTING = /Compacting conversation/i;
/** Its footer while it works, or its turn waiting on its own background work */
const CLAUDE_WORKING =
  /esc to interrupt|waiting for \d+ [\w -]{1,40} to finish/i;
const RULE = /^─{3}/;
const PROMPT = /^[❯>]/;
/** Claude's own tools that ask instead of needing permission */
const ASKING_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

interface Style {
  faint: boolean;
  inverse: boolean;
}

/** A grey foreground, as placeholders and suggestions are drawn */
function greyColor(params: number[], i: number): boolean {
  if (params[i + 1] === 5) {
    const n = params[i + 2];
    return n === 8 || (n >= 239 && n <= 250);
  }
  if (params[i + 1] === 2) {
    const [r, g, b] = params.slice(i + 2, i + 5);
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12 && r >= 80 && r <= 180;
  }
  return false;
}

function applySgr(style: Style, raw: string): void {
  const params = raw === "" ? [0] : raw.split(/[;:]/).map((p) => +p || 0);
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) {
      style.faint = false;
      style.inverse = false;
    } else if (p === 2) style.faint = true;
    else if (p === 22) style.faint = false;
    else if (p === 7) style.inverse = true;
    else if (p === 27) style.inverse = false;
    else if (p === 90) style.faint = true;
    else if (p === 39 || (p >= 30 && p <= 37) || (p >= 91 && p <= 97))
      style.faint = false;
    else if (p === 38) {
      style.faint = greyColor(params, i);
      i += params[i + 1] === 5 ? 2 : 4;
    } else if (p === 48) i += params[i + 1] === 5 ? 2 : 4;
  }
}

/** Each visible character with how it is drawn */
function styledChars(raw: string): { ch: string; style: Style }[] {
  const out: { ch: string; style: Style }[] = [];
  const style: Style = { faint: false, inverse: false };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "\x1b") {
      const sgr = /^\x1b\[([0-9;:]*)m/.exec(raw.slice(i));
      if (sgr) {
        applySgr(style, sgr[1]);
        i += sgr[0].length;
        continue;
      }
      ESCAPE_AT.lastIndex = i;
      const m = ESCAPE_AT.exec(raw);
      i += m ? m[0].length : 1;
      continue;
    }
    const ch = String.fromCodePoint(raw.codePointAt(i)!);
    out.push({ ch, style: { ...style } });
    i += ch.length;
  }
  return out;
}

/** Lines under the input box: the footer, a status line, a hint */
const MAX_UNDER_BOX = 6;

/**
 * Claude's input box (a ❯ line under a rule, closed by another rule) at the
 * bottom of the screen: its first and closing line, or null while a dialog
 * has taken its place
 */
function inputBox(plain: readonly string[]): [number, number] | null {
  for (let i = plain.length - 1; i > 0; i--) {
    if (!PROMPT.test(plain[i]) || !RULE.test(plain[i - 1])) continue;
    const close = plain.findIndex((l, n) => n > i && RULE.test(l));
    if (close < 0) return null;
    const under = plain.slice(close + 1).filter((l) => l.trim()).length;
    return under <= MAX_UNDER_BOX ? [i, close] : null;
  }
  return null;
}

/**
 * Text the user typed into Claude's input box and hasn't sent. Faint text
 * is Claude's placeholder or suggestion, the inverse cell its cursor; a
 * screen with no escapes counts every character (fails closed). Null when
 * there is no input box
 */
export function inputText(rawLines: readonly string[]): string | null {
  const box = inputBox(rawLines.map(stripAnsi));
  if (!box) return null;
  let typed = "";
  let cursorOnly = "";
  let faint = false;
  for (let i = box[0]; i < box[1]; i++) {
    const chars = styledChars(rawLines[i]);
    // Past the ❯ on the first line
    const from = i === box[0] ? 1 : 0;
    for (const { ch, style } of chars.slice(from)) {
      if (!ch.trim()) continue;
      if (style.faint) faint = true;
      else if (style.inverse) cursorOnly += ch;
      else typed += ch;
    }
  }
  // The cursor on a typed letter, with no placeholder around it
  if (!typed && cursorOnly && !faint) typed = cursorOnly;
  return typed;
}

function bottom(plain: readonly string[], n: number): string {
  let end = plain.length;
  while (end > 0 && !plain[end - 1].trim()) end--;
  return plain.slice(Math.max(0, end - n), end).join("\n");
}

/**
 * Claude is idle with text in its input box: what a paste whose Enter got
 * taken in with it leaves behind
 */
export function unsentInput(rawLines: readonly string[]): boolean {
  const plain = rawLines.map(stripAnsi);
  const tail = bottom(plain, 16);
  if (COMPACTING.test(tail) || CLAUDE_WORKING.test(tail)) return false;
  if (readClaudeScreen(plain).spinner) return false;
  return !!inputText(rawLines);
}

function classifyClaude(input: ScreenInput, plain: string[]): Readiness {
  const pending = input.claude?.pendingPermission;
  const tail = bottom(plain, 16);
  const working =
    COMPACTING.test(tail) ||
    CLAUDE_WORKING.test(tail) ||
    !!readClaudeScreen(plain).spinner;

  // A dialog, a picker or a prompt takes the input box's place. What
  // Claude wrote above the box ("Would you like to proceed?") doesn't count
  if (!inputBox(plain)) {
    if (pending) {
      return hold(
        ASKING_TOOLS.has(pending.tool_name) ? "asking" : "permission"
      );
    }
    if (CLAUDE_DIALOGS.some((re) => re.test(bottom(plain, 30))))
      return hold("asking");
    if (parsePermissionPrompt(plain, input.width || 80))
      return hold("permission");
    return hold(working ? "busy" : "unknown");
  }

  // A subagent's request can be waiting while the main box shows
  if (pending) {
    return hold(ASKING_TOOLS.has(pending.tool_name) ? "asking" : "permission");
  }
  if (working) return hold("busy");
  // Set by UserPromptSubmit, cleared by Stop or the idle notice. Unknown
  // (no hooks recorded yet) is not ready
  if (input.claude?.busy === true) return hold("busy");
  if (input.claude?.busy !== false) return hold("unknown");

  const typed = inputText(input.lines);
  if (typed === null) return hold("unknown");
  if (typed) return hold("typing");
  return READY;
}

function classifyOther(input: ScreenInput, plain: string[]): Readiness {
  const content = plain.join("\n");
  const recent = bottom(plain, 30);
  if (
    AGENT_DIALOGS.some((re) => re.test(recent)) ||
    checkWaitingPatterns(content)
  )
    return hold("asking");
  if (checkBusyIndicators(content)) return hold("busy");
  switch (input.status) {
    case "running":
      return hold("busy");
    case "idle":
    case "waiting":
      // "waiting" is idle that nobody has looked at yet
      return READY;
    default:
      return hold("unknown");
  }
}

/** The readiness rule over one read of the screen and state */
export function classifyScreen(input: ScreenInput): Readiness {
  // Copy mode: the user is scrolling the pane, and would eat the paste
  if (input.paneInMode) return hold("typing");
  const plain = input.lines.map(stripAnsi);
  return input.agentType === "claude"
    ? classifyClaude(input, plain)
    : classifyOther(input, plain);
}

export async function readiness(
  session: Session,
  /** The handoff's own reads of its source */
  options: { duringHandoff?: boolean } = {}
): Promise<Readiness> {
  // Handed off (M4): its tmux ended, nothing goes in until it is resumed
  if (session.paused_at) return hold("paused");
  // Settled (M8): its tmux ended too, nothing goes in until Undo or Resume
  if (session.settled_at) return hold("settled");
  // Being handed off: no new turn until it is done (or given up)
  if (!options.duringHandoff && isHandingOff(session.id))
    return hold("handing_off");
  // Hit a usage limit that hasn't reset: anything typed would bounce
  // (flag `limits` is its kill switch)
  if (getFlags().limits && limitStateOf(session).limited)
    return hold("limited");
  const name = tmuxNameOf(session);
  try {
    // display-message prints nothing (and succeeds) for a missing target
    await execFileAsync("tmux", ["has-session", "-t", `=${name}`]);
    const pane = `=${name}:`;
    const [{ stdout: info }, { stdout: screen }] = await Promise.all([
      execFileAsync("tmux", [
        "display-message",
        "-p",
        "-t",
        pane,
        "#{pane_in_mode}\t#{pane_width}",
      ]),
      execFileAsync("tmux", ["capture-pane", "-p", "-e", "-t", pane]),
    ]);
    const [mode, width] = info.trim().split("\t");
    if (mode !== "0" && mode !== "1") return hold("unknown");
    const agentType = session.agent_type || "claude";
    const input: ScreenInput = {
      agentType,
      lines: screen.replace(/\n$/, "").split("\n"),
      width: Number(width) || 80,
      paneInMode: mode === "1",
    };
    if (agentType === "claude") {
      input.claude = readClaudeState(session.id);
    } else {
      input.status =
        latest(session.id)?.status ?? (await statusDetector.getStatus(name));
    }
    return classifyScreen(input);
  } catch {
    // Gone, or tmux failed: not ready
    return hold("unknown");
  }
}
