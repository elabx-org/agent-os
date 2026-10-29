#!/usr/bin/env node
/**
 * Applies the schema and pending migrations to a database file and exits,
 * as the server does at start, without starting anything else. For testing
 * migrations on a copy of a database:
 *
 *   node scripts/migrate-only.mjs /tmp/mig-test.db
 *
 * Refuses the live database under ~/.agent-os.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { tsImport } from "tsx/esm/api";

const file = process.argv[2];
if (!file) {
  console.error("Usage: migrate-only.mjs <database file>");
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(2);
}

const real = fs.realpathSync(file);
const liveHome = path.join(os.homedir(), ".agent-os") + path.sep;
if (real.startsWith(liveHome) || real.startsWith("/config/.agent-os/")) {
  console.error(`Refusing the live database: ${real}`);
  process.exit(2);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { createSchema } = await tsImport(
  path.join(root, "lib/db/schema.ts"),
  import.meta.url
);
const { runMigrations } = await tsImport(
  path.join(root, "lib/db/migrations.ts"),
  import.meta.url
);

const db = new Database(real, { timeout: 10000 });
try {
  createSchema(db);
  runMigrations(db);
  const last = db.prepare(`SELECT MAX(id) AS id FROM _migrations`).get();
  console.log(`${real}: migrated, latest migration ${last.id}`);
} finally {
  db.close();
}
