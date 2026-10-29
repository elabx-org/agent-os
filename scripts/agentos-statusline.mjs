#!/usr/bin/env node
/*
 * AgentOS: Claude Code status line wrapper. Saves the status line JSON
 * (model, context, cost, rate limits) to <state dir>/status.json for the web
 * UI, then runs the user's own status line command, if they have one, with
 * the same input and prints what it prints. Its first line is saved too
 * (statusline.txt), so the UI shows what the user's footer shows.
 *
 * Usage: agentos-statusline.mjs <state dir>, status JSON on stdin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Not { recursive: true }: Node can spin forever on it in some filesystems.
// The state dir's parent is made by AgentOS; make it again if it's gone.
function ensureDir(dir) {
  for (const d of [path.dirname(dir), dir]) {
    try {
      fs.mkdirSync(d);
    } catch (error) {
      if (error.code !== "EEXIST" && d === dir) throw error;
    }
  }
}

/** The status line command the user set, by Claude Code's precedence */
function userCommand(data) {
  const project = data?.workspace?.project_dir || data?.workspace?.current_dir;
  const configDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const files = [
    project && path.join(project, ".claude", "settings.local.json"),
    project && path.join(project, ".claude", "settings.json"),
    path.join(configDir, "settings.json"),
  ].filter(Boolean);
  for (const file of files) {
    const line = readJson(file)?.statusLine;
    if (line?.type === "command" && typeof line.command === "string") {
      // Never run ourselves
      return line.command.includes("agentos-statusline") ? null : line.command;
    }
  }
  return null;
}

// Colours, cursor moves and OSC links (OSC 8) off: the UI shows plain text
const ANSI =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]/g;

/** The first non-empty line, plain, or removes the file when there's none */
function saveLine(dir, text) {
  const file = path.join(dir, "statusline.txt");
  const line = (text || "")
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.replace(/[\x00-\x1f\x7f]/g, "").trim())
    .find(Boolean);
  if (!line) {
    fs.rmSync(file, { force: true });
    return;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, line.slice(0, 500));
  fs.renameSync(tmp, file);
}

let raw = "";
let data = null;
try {
  raw = fs.readFileSync(0, "utf8");
  data = JSON.parse(raw);
  const dir = process.argv[2];
  if (dir && data && typeof data === "object") {
    ensureDir(dir);
    const file = path.join(dir, "status.json");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, raw);
    fs.renameSync(tmp, file);
  }
} catch {
  // Recording is best effort; the user's line still shows
}

try {
  const command = userCommand(data);
  let output = "";
  if (command) {
    const result = spawnSync(command, {
      input: raw,
      shell: process.env.SHELL || true,
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "ignore"],
    });
    output = result.stdout || "";
    if (output) process.stdout.write(output);
  }
  const dir = process.argv[2];
  if (dir) {
    try {
      saveLine(dir, output);
    } catch {
      // The UI falls back to model · context · cost
    }
  }
} catch {
  // No line rather than an error in Claude's footer
}
process.exitCode = 0;
