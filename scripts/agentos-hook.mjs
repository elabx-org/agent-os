#!/usr/bin/env node
/*
 * Agent-OS: Claude Code command hook that records what the session is doing
 * (permission mode, tool, pending permission, busy) for the web UI.
 *
 * Usage: agentos-hook.mjs <state dir>, hook input JSON on stdin. Appends one
 * line per event to events.jsonl and keeps the latest of each in state.json.
 * Never prints anything and always exits 0: stdout from some events would
 * reach Claude, and a failure here must never change what Claude does.
 */
import fs from "node:fs";
import path from "node:path";

const MAX_LINES = 500;
const KEEP_LINES = 250;
const MAX_INPUT = 2048;
const MAX_MESSAGE = 500;

function capText(text, max) {
  return typeof text === "string" && text.length > max
    ? text.slice(0, max) + "…"
    : text;
}

/** The tool input, cut down to about MAX_INPUT bytes of JSON */
function capInput(input) {
  if (input === undefined) return undefined;
  const json = JSON.stringify(input);
  if (!json || json.length <= MAX_INPUT) return input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const short = {};
    for (const [k, v] of Object.entries(input)) {
      short[k] = typeof v === "string" ? capText(v, 300) : v;
    }
    const shortJson = JSON.stringify(short);
    if (shortJson.length <= MAX_INPUT) return short;
  }
  return { _truncated: json.slice(0, MAX_INPUT) };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Not { recursive: true }: Node can spin forever on it in some filesystems.
// The state dir's parent is made by Agent-OS; make it again if it's gone.
function ensureDir(dir) {
  for (const d of [path.dirname(dir), dir]) {
    try {
      fs.mkdirSync(d);
    } catch (error) {
      if (error.code !== "EEXIST" && d === dir) throw error;
    }
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Parallel tool calls run hooks at once; a short lock keeps state.json whole.
// If it can't be had quickly, write anyway rather than hold Claude up.
function lock(dir) {
  const lockDir = path.join(dir, ".lock");
  for (let i = 0; i < 20; i++) {
    try {
      fs.mkdirSync(lockDir);
      return () => fs.rmdirSync(lockDir);
    } catch {
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > 2000) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch {
        continue;
      }
      sleep(2);
    }
  }
  return () => {};
}

function record(dir, input) {
  const event = input.hook_event_name;
  if (typeof event !== "string") return;
  const now = Date.now();
  const agentId = input.agent_id || undefined;
  const line = {
    t: now,
    event,
    permission_mode: input.permission_mode,
    tool_name: input.tool_name,
    tool_use_id: input.tool_use_id,
    tool_input: capInput(input.tool_input),
    notification_type: input.notification_type,
    message: capText(
      input.message ?? input.last_assistant_message,
      MAX_MESSAGE
    ),
    source: input.source,
    agent_id: agentId,
    agent_type: input.agent_type,
  };

  ensureDir(dir);
  const unlock = lock(dir);
  try {
    const stateFile = path.join(dir, "state.json");
    const state = readJson(stateFile) || {};
    state.session_id = input.session_id ?? state.session_id;
    // A subagent's hooks carry its own mode; the session's is the main one
    if (input.permission_mode && !agentId) {
      state.permission_mode = input.permission_mode;
    }
    const tool = line.tool_name
      ? {
          name: line.tool_name,
          input: line.tool_input ?? null,
          id: line.tool_use_id ?? null,
          agent_id: agentId ?? null,
          at: now,
        }
      : null;

    switch (event) {
      case "SessionStart":
        state.busy = false;
        state.current_tool = null;
        state.pending_permission = null;
        state.notification = null;
        break;
      case "UserPromptSubmit":
        state.busy = true;
        state.pending_permission = null;
        state.notification = null;
        break;
      case "PreToolUse":
        state.busy = true;
        state.current_tool = tool;
        break;
      case "PermissionRequest":
        state.pending_permission = tool;
        break;
      case "PostToolUse":
      case "PostToolUseFailure": {
        const pending = state.pending_permission;
        if (!pending || !pending.id || pending.id === line.tool_use_id) {
          state.pending_permission = null;
        }
        if (state.current_tool?.id === line.tool_use_id) {
          state.current_tool = null;
        }
        break;
      }
      case "Notification":
        state.notification = {
          type: line.notification_type ?? null,
          message: line.message ?? null,
          at: now,
        };
        if (line.notification_type === "idle_prompt") state.busy = false;
        break;
      case "SubagentStart":
        state.busy = true;
        break;
      case "Stop":
        state.busy = false;
        state.current_tool = null;
        state.pending_permission = null;
        break;
    }
    state.last_event = event;
    state.updated_at = now;

    const eventsFile = path.join(dir, "events.jsonl");
    fs.appendFileSync(eventsFile, JSON.stringify(line) + "\n");
    state.lines = (state.lines || 0) + 1;
    if (state.lines > MAX_LINES) {
      const kept = fs
        .readFileSync(eventsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-KEEP_LINES);
      writeAtomic(eventsFile, kept.join("\n") + "\n");
      state.lines = kept.length;
    }
    writeAtomic(stateFile, JSON.stringify(state));
  } finally {
    unlock();
  }
}

try {
  const dir = process.argv[2];
  const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  if (dir && input && typeof input === "object") record(dir, input);
} catch {
  // Recording is best effort
}
process.exit(0);
