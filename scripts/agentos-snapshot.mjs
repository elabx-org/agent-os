#!/usr/bin/env node
/*
 * Agent-OS: hidden git snapshots of a session's working tree, one before
 * and one after each agent turn, so a turn can be shown and undone.
 *
 * A private index under $(git rev-parse --git-path agent-os), seeded from a
 * copy of the user's index, `add -A` (untracked files over 5MB left out),
 * `write-tree`, `commit-tree`, `update-ref refs/agent-os/<session>/t<N>-<point>`.
 * Never touches HEAD, the user's index, stash, branches or config.
 *
 *   agentos-snapshot.mjs snap <cwd> <session id> <turn> <pre|post> [ms]
 *     prints {"ref": ...} (lib/snapshots.ts)
 *   agentos-snapshot.mjs pre|post <state dir>, Claude hook input on stdin
 *     (scripts/agentos-hook.mjs): starts or ends the session's current turn
 *     and appends it to <state dir>/turns.jsonl, which lib/turns.ts ingests
 *
 * Journal lines (one JSON object each, folded by turnNo, the last wins):
 *   {e:"pre", turnNo, cwd, promptExcerpt, claudeSessionId, preRef|null, startedAt}
 *   {e:"touch", turnNo, path, at}   a path the agent's edit tools wrote
 *   {e:"post", turnNo, postRef|null, transcriptUuid|null, endedAt}
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE = 5 * 1024 * 1024;
const SESSION_ID = /^[\w-]+$/;
const EXCERPT = 200;
const JOURNAL = "turns.jsonl";
const CURRENT = "turn.json";
const JOURNAL_ROTATE = 512 * 1024;
const JOURNAL_KEEP_TURNS = 60;
const DEFAULT_TIMEOUT = 3000;
const STALE_LOCK_MS = 10_000;

const IDENTITY = {
  GIT_AUTHOR_NAME: "Agent-OS",
  GIT_AUTHOR_EMAIL: "agent-os@localhost",
  GIT_COMMITTER_NAME: "Agent-OS",
  GIT_COMMITTER_EMAIL: "agent-os@localhost",
};

// Settings that would make an add write anything outside our own index
const SAFE = [
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.splitIndex=false",
];

function baseEnv() {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  return env;
}

/** git with a deadline: resolves {code, stdout}, rejects on timeout or spawn failure */
function git(args, { cwd, env, deadline, input }) {
  const timeout = Math.max(1, deadline - Date.now());
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...SAFE, ...args],
      {
        cwd,
        env: env ?? baseEnv(),
        timeout,
        killSignal: "SIGTERM",
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error && (error.killed || typeof error.code !== "number")) {
          reject(error);
        } else {
          resolve({ code: error ? error.code : 0, stdout: String(stdout) });
        }
      }
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

async function ok(args, opts) {
  const result = await git(args, opts);
  if (result.code !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}

/** Untracked files over MAX_FILE, as `:(exclude)` pathspecs */
async function bigUntracked(top, env, deadline) {
  const out = await ok(["ls-files", "-o", "--exclude-standard", "-z"], {
    cwd: top,
    env,
    deadline,
  });
  const big = [];
  for (const rel of out.split("\0")) {
    if (!rel) continue;
    try {
      const st = fs.lstatSync(path.join(top, rel));
      if (st.isFile() && st.size > MAX_FILE) big.push(rel);
    } catch {
      // Gone since
    }
  }
  return big;
}

function seedIndex(userIndex, privateIndex) {
  if (fs.existsSync(privateIndex)) {
    // A git killed past its deadline can leave the lock behind
    const lockFile = `${privateIndex}.lock`;
    try {
      if (Date.now() - fs.statSync(lockFile).mtimeMs > STALE_LOCK_MS) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // No lock
    }
    return;
  }
  try {
    const tmp = `${privateIndex}.${process.pid}.seed`;
    fs.copyFileSync(userIndex, tmp);
    fs.renameSync(tmp, privateIndex);
  } catch {
    // No user index yet (fresh repo): the first add hashes everything
  }
}

/**
 * Snapshots `cwd`'s working tree as refs/agent-os/<sessionId>/t<turn>-<point>.
 * The ref, or null for a folder outside git, on failure or past the deadline.
 */
export async function takeSnapshot({
  cwd,
  sessionId,
  turnNo,
  point,
  timeoutMs = DEFAULT_TIMEOUT,
}) {
  if (!SESSION_ID.test(String(sessionId))) return null;
  if (!Number.isInteger(turnNo) || turnNo < 1) return null;
  if (point !== "pre" && point !== "post") return null;
  const deadline = Date.now() + timeoutMs;
  try {
    const env = baseEnv();
    const where = (
      await ok(
        [
          "rev-parse",
          "--show-toplevel",
          "--git-path",
          "agent-os",
          "--git-path",
          "index",
        ],
        { cwd, env, deadline }
      )
    ).split("\n");
    const [top, dirRel, indexRel] = where;
    if (!top || !dirRel || !indexRel) return null;
    const dir = path.resolve(cwd, dirRel);
    fs.mkdirSync(dir, { recursive: true });
    const privateIndex = path.join(dir, `index-${sessionId}`);
    seedIndex(path.resolve(cwd, indexRel), privateIndex);

    const own = { ...env, GIT_INDEX_FILE: privateIndex };
    const opts = { cwd: top, env: own, deadline };
    const big = await bigUntracked(top, own, deadline);
    if (big.length > 0) {
      const list = path.join(dir, `exclude-${sessionId}.${process.pid}`);
      fs.writeFileSync(
        list,
        [".", ...big.map((p) => `:(exclude,literal)${p}`)].join("\0") + "\0"
      );
      try {
        await ok(
          ["add", "-A", `--pathspec-from-file=${list}`, "--pathspec-file-nul"],
          opts
        );
      } finally {
        fs.rmSync(list, { force: true });
      }
    } else {
      await ok(["add", "-A"], opts);
    }
    const tree = (await ok(["write-tree"], opts)).trim();

    const prefix = `refs/agent-os/${sessionId}/`;
    const refs = new Map(
      (
        await ok(
          ["for-each-ref", "--format=%(refname) %(objectname)", prefix],
          opts
        )
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" "))
    );
    const parent = [
      ...(point === "post" ? [`t${turnNo}-pre`] : []),
      `t${turnNo - 1}-post`,
      `t${turnNo - 1}-pre`,
    ]
      .map((name) => refs.get(prefix + name))
      .find(Boolean);

    const ref = `${prefix}t${turnNo}-${point}`;
    const commit = (
      await ok(
        [
          "commit-tree",
          "--no-gpg-sign",
          ...(parent ? ["-p", parent] : []),
          "-m",
          `agent-os ${sessionId} t${turnNo}-${point}`,
          tree,
        ],
        { ...opts, env: { ...own, ...IDENTITY } }
      )
    ).trim();
    await ok(["update-ref", ref, commit], opts);
    return ref;
  } catch {
    return null;
  }
}

// --- The Claude turn journal ------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
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

// The detached post of one turn can overlap the next turn's pre
function withLock(dir, fn) {
  const lockDir = path.join(dir, ".turns-lock");
  let held = false;
  for (let i = 0; i < 50 && !held; i++) {
    try {
      fs.mkdirSync(lockDir);
      held = true;
    } catch {
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > 2000) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch {
        continue;
      }
      sleep(5);
    }
  }
  try {
    return fn();
  } finally {
    if (held) fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function append(dir, entry) {
  fs.appendFileSync(path.join(dir, JOURNAL), JSON.stringify(entry) + "\n");
}

/** Keeps the last turns once the journal grows (lib/turns.ts keeps 50) */
function rotate(dir, turnNo) {
  const file = path.join(dir, JOURNAL);
  try {
    if (fs.statSync(file).size < JOURNAL_ROTATE) return;
    const kept = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => {
        try {
          return JSON.parse(line).turnNo > turnNo - JOURNAL_KEEP_TURNS;
        } catch {
          return false;
        }
      });
    writeAtomic(file, kept.join("\n") + "\n");
  } catch {
    // No journal yet
  }
}

function excerpt(text) {
  if (typeof text !== "string") return null;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > EXCERPT ? line.slice(0, EXCERPT) + "…" : line || null;
}

/** UserPromptSubmit: the next turn's pre snapshot */
export async function startTurn(dir, input, timeoutMs) {
  const sessionId = path.basename(dir);
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const startedAt = Date.now();
  const turnNo = withLock(dir, () => {
    const last = readJson(path.join(dir, CURRENT));
    const n = (Number.isInteger(last?.turnNo) ? last.turnNo : 0) + 1;
    writeAtomic(
      path.join(dir, CURRENT),
      JSON.stringify({
        turnNo: n,
        cwd,
        startedAt,
        prompt: excerpt(input.prompt),
        transcriptPath:
          typeof input.transcript_path === "string"
            ? input.transcript_path
            : null,
      })
    );
    rotate(dir, n);
    return n;
  });
  // Left 300ms to write the journal inside the hook's cap
  const preRef = await takeSnapshot({
    cwd,
    sessionId,
    turnNo,
    point: "pre",
    timeoutMs: Math.max(100, timeoutMs - 300),
  });
  withLock(dir, () =>
    append(dir, {
      e: "pre",
      turnNo,
      cwd,
      promptExcerpt: excerpt(input.prompt),
      claudeSessionId:
        typeof input.session_id === "string" ? input.session_id : null,
      preRef,
      startedAt,
    })
  );
}

/** The transcript entry of the turn's prompt, from the transcript's tail */
function findPromptUuid(transcriptPath, prompt, startedAt) {
  if (!transcriptPath || !prompt) return null;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    let text;
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 4 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    const head = prompt.replace(/…$/, "").slice(0, 80);
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry?.type !== "user" || entry.isMeta || !entry.uuid) continue;
      const at = Date.parse(entry.timestamp);
      if (Number.isFinite(at) && at < startedAt - 60_000) break;
      const content = entry.message?.content;
      const said =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((c) => c?.type === "text")
                .map((c) => c.text)
                .join("\n")
            : "";
      if (excerpt(said)?.startsWith(head)) return entry.uuid;
    }
  } catch {
    // No transcript
  }
  return null;
}

/** Stop: the current turn's post snapshot (run detached by the hook) */
export async function endTurn(dir, timeoutMs) {
  const current = readJson(path.join(dir, CURRENT));
  if (!current || !Number.isInteger(current.turnNo)) return;
  const postRef = await takeSnapshot({
    cwd: current.cwd,
    sessionId: path.basename(dir),
    turnNo: current.turnNo,
    point: "post",
    timeoutMs,
  });
  const transcriptUuid = findPromptUuid(
    current.transcriptPath,
    current.prompt,
    current.startedAt
  );
  withLock(dir, () =>
    append(dir, {
      e: "post",
      turnNo: current.turnNo,
      postRef,
      transcriptUuid,
      endedAt: Date.now(),
    })
  );
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** PostToolUse: the file an edit tool wrote, for the current turn */
export function recordTouched(dir, input) {
  if (!EDIT_TOOLS.has(input.tool_name)) return;
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof target !== "string" || !target) return;
  const current = readJson(path.join(dir, CURRENT));
  if (!current || !Number.isInteger(current.turnNo)) return;
  const abs = path.resolve(
    typeof input.cwd === "string" ? input.cwd : current.cwd,
    target
  );
  withLock(dir, () =>
    append(dir, {
      e: "touch",
      turnNo: current.turnNo,
      path: abs,
      at: Date.now(),
    })
  );
}

async function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === "snap") {
    const [cwd, sessionId, turn, point, ms] = rest;
    const ref = await takeSnapshot({
      cwd,
      sessionId,
      turnNo: Number(turn),
      point,
      timeoutMs: Number(ms) || DEFAULT_TIMEOUT,
    });
    process.stdout.write(JSON.stringify({ ref }) + "\n");
    return;
  }
  const dir = rest[0];
  if (!dir || !SESSION_ID.test(path.basename(dir))) return;
  fs.mkdirSync(dir, { recursive: true });
  if (mode === "pre") {
    const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    await startTurn(dir, input ?? {}, Number(rest[1]) || DEFAULT_TIMEOUT);
  } else if (mode === "post") {
    await endTurn(dir, Number(rest[1]) || 30_000);
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked && invoked === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .catch(() => {})
    .finally(() => process.exit(0));
}
