import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { expandPath } from "@/lib/git-status";

const HISTORY_FILE = path.join(os.homedir(), ".claude", "history.jsonl");
const CHUNK = 64 * 1024;
const MAX_LIMIT = 500;

interface HistoryEntry {
  text: string;
  timestamp: number;
}

/**
 * Prompts for a project, newest first. history.jsonl grows for ever (MBs),
 * so it is read backwards in chunks and the scan stops once limit is met.
 */
function readHistory(
  project: string,
  query: string,
  limit: number,
  session: string | null
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const seen = new Set<string>();
  const q = query.toLowerCase();
  const target = path.resolve(project);
  // Cheap substring test before JSON.parse: most lines are other projects
  const needle = JSON.stringify(target).slice(1, -1);

  const take = (line: string) => {
    if (!line.includes(needle)) return;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      return; // A torn or foreign line: skip it
    }
    if (!row || typeof row !== "object") return;
    const {
      display,
      project: p,
      timestamp,
      sessionId,
    } = row as Record<string, unknown>;
    if (typeof display !== "string" || typeof p !== "string") return;
    if (path.resolve(p) !== target) return;
    const text = display.trim();
    if (!text) return;
    // One conversation's prompts, repeats included: the rewind list
    if (session) {
      if (sessionId !== session || text.startsWith("/")) return;
    } else if (seen.has(text)) return;
    if (q && !text.toLowerCase().includes(q)) return;
    seen.add(text);
    out.push({
      text,
      timestamp: typeof timestamp === "number" ? timestamp : 0,
    });
  };

  let fd: number;
  try {
    fd = fs.openSync(HISTORY_FILE, "r");
  } catch {
    return out;
  }
  try {
    let pos = fs.fstatSync(fd).size;
    // Bytes of a line cut by the chunk boundary, carried to the next read
    let tail = Buffer.alloc(0);
    const buf = Buffer.alloc(CHUNK);
    while (pos > 0 && out.length < limit) {
      const size = Math.min(CHUNK, pos);
      pos -= size;
      fs.readSync(fd, buf, 0, size, pos);
      const data = Buffer.concat([buf.subarray(0, size), tail]);
      // Split on raw newlines so multi-byte characters never break
      let end = data.length;
      for (let i = data.length - 1; i >= 0 && out.length < limit; i--) {
        if (data[i] !== 0x0a) continue;
        take(data.subarray(i + 1, end).toString("utf-8"));
        end = i;
      }
      tail = data.subarray(0, end);
    }
    if (pos === 0 && out.length < limit) take(tail.toString("utf-8"));
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

// Keyed on the file's size and mtime, so a new prompt invalidates it
const cache = new Map<string, HistoryEntry[]>();

/**
 * GET /api/claude/history?project=...&q=...&limit=50&session=...
 * Recent Claude Code prompts for a project, newest first, de-duplicated;
 * with session, every prompt of that Claude conversation
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  if (!project) {
    return NextResponse.json(
      { error: "project parameter is required" },
      { status: 400 }
    );
  }
  const q = params.get("q")?.trim() ?? "";
  const session = params.get("session");
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") || "50", 10) || 50, 1),
    MAX_LIMIT
  );

  try {
    let stamp: string;
    try {
      const st = fs.statSync(HISTORY_FILE);
      stamp = `${st.size}:${st.mtimeMs}`;
    } catch {
      return NextResponse.json({ entries: [] });
    }
    const key = `${expandPath(project)}\0${q}\0${limit}\0${session}\0${stamp}`;
    let entries = cache.get(key);
    if (!entries) {
      entries = readHistory(expandPath(project), q, limit, session);
      if (cache.size > 100) cache.clear();
      cache.set(key, entries);
    }
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Error reading Claude history:", error);
    return NextResponse.json(
      { error: "Failed to read history" },
      { status: 500 }
    );
  }
}
