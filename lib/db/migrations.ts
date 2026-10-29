import type Database from "better-sqlite3";

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * ALTER TABLE ADD COLUMN unless the column is there. The runner records a
 * migration that throws "duplicate column" as applied, which would skip the
 * statements after it; new migrations use this instead.
 */
export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  type: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** A migration of several statements that applies fully or not at all */
function atomic(up: Migration["up"]): Migration["up"] {
  return (db) => db.transaction(() => up(db))();
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
  {
    id: 17,
    name: "add_preferences_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS preferences (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    id: 18,
    name: "add_pinned_order_to_sessions",
    up: (db) => {
      // Null: not pinned. Pinned sessions lead their project in this order
      db.exec(`ALTER TABLE sessions ADD COLUMN pinned_order INTEGER`);
    },
  },
  {
    id: 19,
    name: "add_instructions_to_projects",
    up: (db) => {
      // Standing rules every Claude session in the project starts with
      db.exec(`ALTER TABLE projects ADD COLUMN instructions TEXT`);
    },
  },
  {
    id: 20,
    name: "add_hooks_to_projects",
    up: (db) => {
      // JSON list of Claude Code hooks every session in the project gets
      db.exec(`ALTER TABLE projects ADD COLUMN hooks TEXT`);
    },
  },
  {
    id: 21,
    name: "add_session_drafts_table",
    up: (db) => {
      // What's typed in a session's message box and not sent yet, so it
      // survives a reload and follows the user to another device
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_drafts (
          session_id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    },
  },
  {
    id: 22,
    name: "add_permission_mode_to_sessions",
    up: atomic((db) => {
      addColumnIfMissing(db, "sessions", "permission_mode", "TEXT");
      addColumnIfMissing(db, "sessions", "permission_pending", "TEXT");
      addColumnIfMissing(db, "sessions", "launch_caps", "TEXT");
      // Codex's auto-approve flag is --full-auto (sandboxed), i.e. "auto";
      // every other agent's is its full access flag
      db.exec(
        `UPDATE sessions SET permission_mode = CASE WHEN agent_type = 'codex' THEN 'auto' ELSE 'bypassPermissions' END WHERE auto_approve = 1 AND permission_mode IS NULL`
      );
    }),
  },
  {
    id: 23,
    name: "add_agent_actions_table",
    up: atomic((db) => {
      // What agents tried on other sessions' permissions, allowed or refused
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_actions (
          id INTEGER PRIMARY KEY,
          actor_session_id TEXT,
          actor_tmux TEXT,
          target_session_id TEXT NOT NULL,
          action TEXT NOT NULL,
          allowed INTEGER NOT NULL,
          detail TEXT,
          at INTEGER NOT NULL
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_agent_actions_target ON agent_actions(target_session_id, at)`
      );
    }),
  },
  {
    id: 24,
    name: "add_pinned_and_group_to_projects",
    up: atomic((db) => {
      // Projects page: pinned ones on top, then the user's own groups
      addColumnIfMissing(db, "projects", "pinned", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "projects", "group_name", "TEXT");
    }),
  },
  {
    id: 25,
    name: "add_session_queue_table",
    up: atomic((db) => {
      // Messages waiting for a session to be ready (lib/queue/store.ts).
      // origin: user|system|agent; kind: message|command|resume|undo_notice
      // (an undo_notice is never sent alone: it prefixes the next message);
      // status: pending|sending|sent|cancelled|failed
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_queue (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          text TEXT NOT NULL,
          attachments TEXT,
          origin TEXT NOT NULL DEFAULT 'user',
          kind TEXT NOT NULL DEFAULT 'message',
          status TEXT NOT NULL DEFAULT 'pending',
          not_before INTEGER,
          created_at INTEGER NOT NULL,
          sent_at INTEGER,
          error TEXT
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_queue_session ON session_queue(session_id, status, position)`
      );
    }),
  },
  {
    id: 26,
    name: "add_session_turns_table",
    up: atomic((db) => {
      // One row per agent turn with its snapshot refs (lib/turns.ts)
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_turns (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_no INTEGER NOT NULL,
          cwd TEXT NOT NULL,
          prompt_excerpt TEXT,
          transcript_uuid TEXT,
          pre_ref TEXT,
          post_ref TEXT,
          started_at INTEGER,
          ended_at INTEGER,
          files_json TEXT,
          touched_json TEXT,
          added INTEGER,
          removed INTEGER,
          undone_at INTEGER,
          UNIQUE(session_id, turn_no)
        )
      `);
    }),
  },
  {
    id: 27,
    name: "add_script_runs_and_project_trust_tables",
    up: atomic((db) => {
      // A project script's runs (lib/script-runs.ts); status:
      // running|passed|failed|stopped; times in epoch ms
      db.exec(`
        CREATE TABLE IF NOT EXISTS script_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          script_id TEXT NOT NULL,
          command TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          exit_code INTEGER,
          pid INTEGER,
          log_path TEXT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER
        )
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_script_runs_project ON script_runs(project_id, script_id, started_at)`
      );
      // Config file hashes the user approved (lib/project-config.ts)
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_trust (
          project_id TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          trusted_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, config_hash)
        )
      `);
    }),
  },
  {
    id: 28,
    name: "add_handoff_to_sessions",
    up: atomic((db) => {
      // M4: a session handed off to another agent stays listed, paused
      // (tmux ended, transcript kept); effort is applied on the next launch
      addColumnIfMissing(db, "sessions", "paused_at", "INTEGER");
      addColumnIfMissing(db, "sessions", "handoff_from_session_id", "TEXT");
      addColumnIfMissing(db, "sessions", "handoff_to_session_id", "TEXT");
      addColumnIfMissing(db, "sessions", "effort", "TEXT");
      // 1: the model was picked, so --model goes even for "sonnet" (which
      // otherwise stands for Claude's own default)
      addColumnIfMissing(db, "sessions", "model_pinned", "INTEGER");
    }),
  },
  {
    id: 29,
    name: "add_usage_limit_to_sessions",
    up: atomic((db) => {
      // Usage-limit "Limited" state and its resume (lib/limits)
      addColumnIfMissing(db, "sessions", "limited_at", "INTEGER");
      addColumnIfMissing(db, "sessions", "limited_until", "INTEGER");
      addColumnIfMissing(db, "sessions", "limit_kind", "TEXT");
      addColumnIfMissing(db, "sessions", "resume_policy", "TEXT");
      addColumnIfMissing(db, "sessions", "resume_text", "TEXT");
    }),
  },
  {
    id: 31,
    name: "add_session_summaries",
    up: atomic((db) => {
      // Attach a session with @ (M9): its summary, cached until the
      // transcript grows (lib/session-summaries.ts)
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_summaries (
          session_id TEXT PRIMARY KEY,
          basis TEXT NOT NULL,
          text TEXT NOT NULL,
          tokens INTEGER NOT NULL,
          source TEXT NOT NULL,
          empty INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);
      // The sessions a queued message attaches, resolved when it goes;
      // apart from attachments so an older build still reads those
      addColumnIfMissing(db, "session_queue", "sessions", "TEXT");
    }),
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
