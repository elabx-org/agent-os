/**
 * machine_jobs rows (migration 45). One table on both sides: role 'sent'
 * for jobs asked from here (machine_id runs it), role 'run' for jobs that
 * run here (machine_id asked). Server only.
 */

import { randomBytes } from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import type { JobChanged, JobCode, JobState, JobVia } from "./types";

export type JobRole = "sent" | "run";

export interface JobRow {
  id: string;
  role: JobRole;
  machine_id: string;
  origin_session: string | null;
  origin_name: string | null;
  project_id: string | null;
  title: string;
  task: string;
  state: JobState;
  step: string | null;
  question: string | null;
  job_session: string | null;
  repo: string | null;
  folder: string | null;
  cache: string | null;
  code: string | null;
  result: string | null;
  changed: string | null;
  error: string | null;
  via: JobVia | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  remove_at: number | null;
}

export const newJobId = () => `job_${randomBytes(6).toString("hex")}`;

export function jobRow(
  id: string,
  role: JobRole,
  db: Database.Database = getDb()
): JobRow | null {
  return (
    (db
      .prepare(`SELECT * FROM machine_jobs WHERE id = ? AND role = ?`)
      .get(id, role) as JobRow | undefined) ?? null
  );
}

export function insertJob(
  row: Pick<JobRow, "id" | "role" | "machine_id" | "title" | "task" | "state"> &
    Partial<JobRow>,
  db: Database.Database = getDb()
): void {
  db.prepare(
    `INSERT INTO machine_jobs
       (id, role, machine_id, origin_session, origin_name, project_id, title,
        task, state, step, repo, folder, cache, code, via, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.role,
    row.machine_id,
    row.origin_session ?? null,
    row.origin_name ?? null,
    row.project_id ?? null,
    row.title,
    row.task,
    row.state,
    row.step ?? null,
    row.repo ?? null,
    row.folder ?? null,
    row.cache ?? null,
    row.code ?? null,
    row.via ?? null,
    row.created_at ?? Date.now()
  );
}

const COLUMNS = new Set([
  "state",
  "step",
  "question",
  "job_session",
  "repo",
  "folder",
  "cache",
  "code",
  "result",
  "changed",
  "error",
  "started_at",
  "ended_at",
  "remove_at",
]);

/** Sets the named columns; only while the row is in one of `whileIn` if given */
export function updateJob(
  id: string,
  role: JobRole,
  fields: Partial<JobRow>,
  whileIn?: JobState[],
  db: Database.Database = getDb()
): boolean {
  const names = Object.keys(fields).filter((name) => COLUMNS.has(name));
  if (names.length === 0) return false;
  const values = names.map((name) => fields[name as keyof JobRow] ?? null);
  const guard = whileIn?.length
    ? ` AND state IN (${whileIn.map(() => "?").join(", ")})`
    : "";
  return (
    db
      .prepare(
        `UPDATE machine_jobs SET ${names.map((n) => `${n} = ?`).join(", ")}
         WHERE id = ? AND role = ?${guard}`
      )
      .run(...values, id, role, ...(whileIn ?? [])).changes > 0
  );
}

export function jobsIn(
  role: JobRole,
  states: JobState[],
  db: Database.Database = getDb()
): JobRow[] {
  return db
    .prepare(
      `SELECT * FROM machine_jobs WHERE role = ? AND state IN (${states
        .map(() => "?")
        .join(", ")}) ORDER BY created_at`
    )
    .all(role, ...states) as JobRow[];
}

/** Newest first */
export function recentJobs(
  role: JobRole,
  filter: { session?: string; machine?: string; limit?: number } = {},
  db: Database.Database = getDb()
): JobRow[] {
  const where = ["role = ?"];
  const values: (string | number)[] = [role];
  if (filter.session) {
    where.push("origin_session = ?");
    values.push(filter.session);
  }
  if (filter.machine) {
    where.push("machine_id = ?");
    values.push(filter.machine);
  }
  return db
    .prepare(
      `SELECT * FROM machine_jobs WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(...values, Math.min(Math.max(filter.limit ?? 50, 1), 200)) as JobRow[];
}

export function deleteJobsBefore(
  role: JobRole,
  before: number,
  db: Database.Database = getDb()
): void {
  db.prepare(
    `DELETE FROM machine_jobs
     WHERE role = ? AND ended_at IS NOT NULL AND ended_at < ? AND folder IS NULL`
  ).run(role, before);
}

export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const codeOf = (row: JobRow) => parseJson<JobCode>(row.code);
export const changedOf = (row: JobRow) => parseJson<JobChanged>(row.changed);
