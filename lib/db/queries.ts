import type Database from "better-sqlite3";

// Prepared statement cache
const stmtCache = new Map<string, Database.Statement>();

function getStmt(db: Database.Database, sql: string): Database.Statement {
  const key = sql;
  let stmt = stmtCache.get(key);
  if (!stmt) {
    stmt = db.prepare(sql);
    stmtCache.set(key, stmt);
  }
  return stmt;
}

export const queries = {
  // Sessions
  createSession: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO sessions (id, name, tmux_name, working_directory, parent_session_id, model, system_prompt, group_path, agent_type, auto_approve, continue_session, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),

  getSession: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM sessions WHERE id = ?`),

  getAllSessions: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM sessions ORDER BY updated_at DESC`),

  updateSessionStatus: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionClaudeId: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionName: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET name = ?, tmux_name = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  deleteSession: (db: Database.Database) =>
    getStmt(db, `DELETE FROM sessions WHERE id = ?`),

  updateSessionWorktree: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET worktree_path = ?, branch_name = ?, base_branch = ?, dev_server_port = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionPR: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET pr_url = ?, pr_number = ?, pr_status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateSessionGroup: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET group_path = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  getSessionsByGroup: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM sessions WHERE group_path = ? ORDER BY updated_at DESC`
    ),

  moveSessionsToGroup: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET group_path = ?, updated_at = datetime('now') WHERE group_path = ?`
    ),

  updateSessionProject: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET project_id = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  getSessionsByProject: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC`
    ),

  // Orchestration
  getWorkersByConductor: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM sessions WHERE conductor_session_id = ? ORDER BY created_at ASC`
    ),

  updateWorkerStatus: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE sessions SET worker_status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  createWorkerSession: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO sessions (id, name, tmux_name, working_directory, conductor_session_id, worker_task, worker_status, model, group_path, agent_type, project_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ),

  // Messages
  createMessage: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO messages (session_id, role, content, duration_ms)
       VALUES (?, ?, ?, ?)`
    ),

  getSessionMessages: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC`
    ),

  getLastMessage: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1`
    ),

  updateMessageDuration: (db: Database.Database) =>
    getStmt(db, `UPDATE messages SET duration_ms = ? WHERE id = ?`),

  // Tool calls
  createToolCall: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO tool_calls (message_id, session_id, tool_name, tool_input, status)
       VALUES (?, ?, ?, ?, 'pending')`
    ),

  updateToolCallResult: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE tool_calls SET tool_result = ?, status = ? WHERE id = ?`
    ),

  updateToolCallStatus: (db: Database.Database) =>
    getStmt(db, `UPDATE tool_calls SET status = ? WHERE id = ?`),

  getSessionToolCalls: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM tool_calls WHERE session_id = ? ORDER BY timestamp ASC`
    ),

  getMessageToolCalls: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM tool_calls WHERE message_id = ? ORDER BY timestamp ASC`
    ),

  // Groups
  getAllGroups: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM groups ORDER BY sort_order ASC, name ASC`),

  getGroup: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM groups WHERE path = ?`),

  createGroup: (db: Database.Database) =>
    getStmt(db, `INSERT INTO groups (path, name, sort_order) VALUES (?, ?, ?)`),

  updateGroupName: (db: Database.Database) =>
    getStmt(db, `UPDATE groups SET name = ? WHERE path = ?`),

  updateGroupExpanded: (db: Database.Database) =>
    getStmt(db, `UPDATE groups SET expanded = ? WHERE path = ?`),

  updateGroupOrder: (db: Database.Database) =>
    getStmt(db, `UPDATE groups SET sort_order = ? WHERE path = ?`),

  deleteGroup: (db: Database.Database) =>
    getStmt(db, `DELETE FROM groups WHERE path = ?`),

  // Projects
  createProject: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO projects (id, name, working_directory, agent_type, default_model, initial_prompt, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),

  getProject: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM projects WHERE id = ?`),

  getAllProjects: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM projects ORDER BY is_uncategorized ASC, sort_order ASC, name ASC`
    ),

  updateProject: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE projects SET name = ?, working_directory = ?, agent_type = ?, default_model = ?, initial_prompt = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateProjectExpanded: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET expanded = ? WHERE id = ?`),

  updateProjectOrder: (db: Database.Database) =>
    getStmt(db, `UPDATE projects SET sort_order = ? WHERE id = ?`),

  deleteProject: (db: Database.Database) =>
    getStmt(db, `DELETE FROM projects WHERE id = ? AND is_uncategorized = 0`),

  // Project dev servers
  createProjectDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO project_dev_servers (id, project_id, name, type, command, port, port_env_var, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),

  getProjectDevServer: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM project_dev_servers WHERE id = ?`),

  getProjectDevServers: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM project_dev_servers WHERE project_id = ? ORDER BY sort_order ASC`
    ),

  updateProjectDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE project_dev_servers SET name = ?, type = ?, command = ?, port = ?, port_env_var = ?, sort_order = ? WHERE id = ?`
    ),

  deleteProjectDevServer: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_dev_servers WHERE id = ?`),

  deleteProjectDevServers: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_dev_servers WHERE project_id = ?`),

  // Project repositories
  createProjectRepository: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO project_repositories (id, project_id, name, path, is_primary, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),

  getProjectRepository: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM project_repositories WHERE id = ?`),

  getProjectRepositories: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM project_repositories WHERE project_id = ? ORDER BY sort_order ASC`
    ),

  updateProjectRepository: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE project_repositories SET name = ?, path = ?, is_primary = ?, sort_order = ? WHERE id = ?`
    ),

  deleteProjectRepository: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_repositories WHERE id = ?`),

  deleteProjectRepositories: (db: Database.Database) =>
    getStmt(db, `DELETE FROM project_repositories WHERE project_id = ?`),

  // Dev servers
  createDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO dev_servers (id, project_id, type, name, command, status, pid, container_id, ports, working_directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),

  getDevServer: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM dev_servers WHERE id = ?`),

  getAllDevServers: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM dev_servers ORDER BY created_at DESC`),

  getDevServersByProject: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM dev_servers WHERE project_id = ? ORDER BY created_at DESC`
    ),

  updateDevServerStatus: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE dev_servers SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateDevServerPid: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE dev_servers SET pid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  updateDevServer: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE dev_servers SET status = ?, pid = ?, container_id = ?, ports = ?, updated_at = datetime('now') WHERE id = ?`
    ),

  deleteDevServer: (db: Database.Database) =>
    getStmt(db, `DELETE FROM dev_servers WHERE id = ?`),

  deleteDevServersByProject: (db: Database.Database) =>
    getStmt(db, `DELETE FROM dev_servers WHERE project_id = ?`),

  // Store sources
  getStoreSources: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM store_sources ORDER BY is_builtin DESC, label ASC`
    ),

  getStoreSource: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM store_sources WHERE id = ?`),

  upsertStoreSource: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO store_sources (id, repo, branch, type, label, is_builtin)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET repo=excluded.repo, branch=excluded.branch,
         type=excluded.type, label=excluded.label, updated_at=datetime('now')`
    ),

  updateStoreSourceSync: (db: Database.Database) =>
    getStmt(
      db,
      `UPDATE store_sources SET sync_status = ?, sync_error = ?,
       last_synced_at = CASE WHEN ?1 = 'synced' THEN datetime('now') ELSE last_synced_at END,
       updated_at = datetime('now') WHERE id = ?4`
    ),

  deleteStoreSource: (db: Database.Database) =>
    getStmt(
      db,
      `DELETE FROM store_sources WHERE id = ? AND is_builtin = 0`
    ),

  // Store items
  getAllStoreItems: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM store_items ORDER BY type ASC, name ASC`
    ),

  getStoreItemsByType: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM store_items WHERE type = ? ORDER BY name ASC`
    ),

  getStoreItemsBySource: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM store_items WHERE source_id = ? ORDER BY name ASC`
    ),

  searchStoreItems: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM store_items
       WHERE (name LIKE ?1 OR dir_name LIKE ?1 OR description LIKE ?1 OR source_label LIKE ?1)
       ORDER BY type ASC, name ASC`
    ),

  searchStoreItemsByType: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM store_items
       WHERE type = ?1 AND (name LIKE ?2 OR dir_name LIKE ?2 OR description LIKE ?2 OR source_label LIKE ?2)
       ORDER BY name ASC`
    ),

  upsertStoreItem: (db: Database.Database) =>
    getStmt(
      db,
      `INSERT INTO store_items (id, source_id, type, dir_name, name, description,
         source_label, url, content_url, contents_url, raw_base, is_enriched,
         mcp_version, mcp_registry_type, mcp_package_identifier, mcp_repo_url,
         mcp_env_vars, download_files)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
         source_label=excluded.source_label, url=excluded.url, content_url=excluded.content_url,
         contents_url=excluded.contents_url, raw_base=excluded.raw_base,
         is_enriched=excluded.is_enriched, mcp_version=excluded.mcp_version,
         mcp_registry_type=excluded.mcp_registry_type,
         mcp_package_identifier=excluded.mcp_package_identifier,
         mcp_repo_url=excluded.mcp_repo_url, mcp_env_vars=excluded.mcp_env_vars,
         download_files=excluded.download_files, updated_at=datetime('now')`
    ),

  deleteStoreItemsBySource: (db: Database.Database) =>
    getStmt(db, `DELETE FROM store_items WHERE source_id = ?`),

  deleteStaleStoreItems: (db: Database.Database) =>
    getStmt(
      db,
      `DELETE FROM store_items WHERE source_id = ? AND id NOT IN (SELECT value FROM json_each(?))`
    ),

  getUnenrichedStoreItems: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT * FROM store_items WHERE is_enriched = 0 AND type != 'mcp' LIMIT ?`
    ),

  getStoreItemCounts: (db: Database.Database) =>
    getStmt(
      db,
      `SELECT type, COUNT(*) as count FROM store_items GROUP BY type`
    ),

  getStoreItem: (db: Database.Database) =>
    getStmt(db, `SELECT * FROM store_items WHERE id = ?`),
};
