import type Database from "better-sqlite3";

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

// All migrations in order - never modify existing ones, only add new
const migrations: Migration[] = [
  {
    id: 1,
    name: "add_group_path_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN group_path TEXT NOT NULL DEFAULT 'sessions'`
      );
    },
  },
  {
    id: 2,
    name: "add_agent_type_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude'`
      );
    },
  },
  {
    id: 3,
    name: "add_worktree_columns_to_sessions",
    up: (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN worktree_path TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN branch_name TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN base_branch TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN dev_server_port INTEGER`);
    },
  },
  {
    id: 4,
    name: "add_pr_tracking_to_sessions",
    up: (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN pr_url TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN pr_number INTEGER`);
      db.exec(`ALTER TABLE sessions ADD COLUMN pr_status TEXT`);
    },
  },
  {
    id: 5,
    name: "add_group_path_index",
    up: (db) => {
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_path)`
      );
    },
  },
  {
    id: 6,
    name: "add_orchestration_columns_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN conductor_session_id TEXT REFERENCES sessions(id)`
      );
      db.exec(`ALTER TABLE sessions ADD COLUMN worker_task TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN worker_status TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_conductor ON sessions(conductor_session_id)`
      );
    },
  },
  {
    id: 7,
    name: "add_auto_approve_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
  {
    id: 8,
    name: "add_dev_server_columns",
    up: (db) => {
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN type TEXT NOT NULL DEFAULT 'node'`
      );
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN name TEXT NOT NULL DEFAULT ''`
      );
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN command TEXT NOT NULL DEFAULT ''`
      );
      db.exec(`ALTER TABLE dev_servers ADD COLUMN pid INTEGER`);
      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN working_directory TEXT NOT NULL DEFAULT ''`
      );
    },
  },
  {
    id: 9,
    name: "add_project_id_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`
      );
      db.exec(
        `UPDATE sessions SET project_id = 'uncategorized' WHERE project_id IS NULL`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`
      );
    },
  },
  {
    id: 10,
    name: "add_project_id_to_dev_servers",
    up: (db) => {
      // Check if column exists first
      const cols = db.prepare(`PRAGMA table_info(dev_servers)`).all() as {
        name: string;
      }[];
      if (cols.some((c) => c.name === "project_id")) return;

      db.exec(
        `ALTER TABLE dev_servers ADD COLUMN project_id TEXT REFERENCES projects(id)`
      );
      // Migrate from session_id if it exists
      const hasSessionId = cols.some((c) => c.name === "session_id");
      if (hasSessionId) {
        db.exec(`
          UPDATE dev_servers
          SET project_id = (
            SELECT COALESCE(s.project_id, 'uncategorized')
            FROM sessions s
            WHERE s.id = dev_servers.session_id
          )
          WHERE project_id IS NULL
        `);
      }
      db.exec(
        `UPDATE dev_servers SET project_id = 'uncategorized' WHERE project_id IS NULL`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_dev_servers_project ON dev_servers(project_id)`
      );
    },
  },
  {
    id: 11,
    name: "add_tmux_name_to_sessions",
    up: (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN tmux_name TEXT`);
      // Backfill existing sessions with computed tmux name
      db.exec(
        `UPDATE sessions SET tmux_name = agent_type || '-' || id WHERE tmux_name IS NULL`
      );
    },
  },
  {
    id: 12,
    name: "add_initial_prompt_to_projects",
    up: (db) => {
      db.exec(`ALTER TABLE projects ADD COLUMN initial_prompt TEXT`);
    },
  },
  {
    id: 13,
    name: "add_project_repositories_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_repositories (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          is_primary INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_project_repositories_project ON project_repositories(project_id)`
      );
    },
  },
  {
    id: 14,
    name: "add_continue_session_to_sessions",
    up: (db) => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN continue_session INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
  {
    id: 15,
    name: "add_store_tables",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS store_sources (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          branch TEXT NOT NULL DEFAULT 'main',
          type TEXT NOT NULL DEFAULT 'skill',
          label TEXT NOT NULL,
          is_builtin INTEGER NOT NULL DEFAULT 0,
          last_synced_at TEXT,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          sync_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS store_items (
          id TEXT PRIMARY KEY,
          source_id TEXT,
          type TEXT NOT NULL,
          dir_name TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          source_label TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          content_url TEXT NOT NULL DEFAULT '',
          contents_url TEXT NOT NULL DEFAULT '',
          raw_base TEXT NOT NULL DEFAULT '',
          is_enriched INTEGER NOT NULL DEFAULT 0,
          mcp_version TEXT,
          mcp_registry_type TEXT,
          mcp_package_identifier TEXT,
          mcp_repo_url TEXT,
          mcp_env_vars TEXT,
          download_files TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (source_id) REFERENCES store_sources(id) ON DELETE CASCADE
        )
      `);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_store_items_source ON store_items(source_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_store_items_type ON store_items(type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_store_items_enriched ON store_items(is_enriched)`);

      // Seed built-in sources
      const insert = db.prepare(
        `INSERT OR IGNORE INTO store_sources (id, repo, branch, type, label, is_builtin) VALUES (?, ?, ?, ?, ?, 1)`
      );
      insert.run("builtin-anthropic", "anthropics/skills", "main", "skill", "Anthropic");
      insert.run("builtin-daymade", "daymade/claude-code-skills", "main", "skill", "daymade");
      insert.run("builtin-voltagent", "VoltAgent/awesome-claude-code-subagents", "main", "agent", "VoltAgent");
    },
  },
  {
    id: 16,
    name: "add_git_sync_interval_to_projects",
    up: (db) => {
      db.exec(
        `ALTER TABLE projects ADD COLUMN git_sync_interval INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    (db.prepare(`SELECT id FROM _migrations`).all() as { id: number }[]).map(
      (r) => r.id
    )
  );

  // Use INSERT OR IGNORE to handle concurrent workers
  const insertMigration = db.prepare(
    `INSERT OR IGNORE INTO _migrations (id, name) VALUES (?, ?)`
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    try {
      migration.up(db);
      const result = insertMigration.run(migration.id, migration.name);
      if (result.changes > 0) {
        console.log(`Migration ${migration.id}: ${migration.name} applied`);
      } else {
        console.log(
          `Migration ${migration.id}: ${migration.name} skipped (concurrent apply)`
        );
      }
    } catch (error) {
      // Some migrations may fail if columns already exist (from old system or concurrent worker)
      // Try to record as applied anyway to prevent re-running
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes("duplicate column") ||
        errorMsg.includes("already exists")
      ) {
        insertMigration.run(migration.id, migration.name);
        console.log(
          `Migration ${migration.id}: ${migration.name} skipped (already applied)`
        );
      } else {
        console.error(
          `Migration ${migration.id}: ${migration.name} failed:`,
          error
        );
        throw error;
      }
    }
  }
}
