import type { AgentType } from "../providers";

export interface Session {
  id: string;
  name: string;
  tmux_name: string;
  created_at: string;
  updated_at: string;
  status: "idle" | "running" | "waiting" | "error";
  working_directory: string;
  parent_session_id: string | null;
  claude_session_id: string | null;
  model: string;
  system_prompt: string | null;
  group_path: string; // Deprecated - use project_id
  project_id: string | null;
  agent_type: AgentType;
  auto_approve: boolean;
  continue_session: boolean;
  // Worktree fields (optional)
  worktree_path: string | null;
  branch_name: string | null;
  base_branch: string | null;
  dev_server_port: number | null;
  // PR tracking
  pr_url: string | null;
  pr_number: number | null;
  pr_status: "open" | "merged" | "closed" | null;
  // Orchestration fields
  conductor_session_id: string | null;
  worker_task: string | null;
  worker_status: "pending" | "running" | "completed" | "failed" | null;
  // Pinned sessions lead their project, in this order; null when not pinned
  pinned_order: number | null;
  // Permission mode (lib/permission-mode.ts normalizeMode); NULL = agent default
  permission_mode: string | null;
  // Mode waiting to be applied at the next idle edge
  permission_pending: string | null;
  // JSON LaunchCaps recorded at launch
  launch_caps: string | null;
  // M4 handoff (migration 28): ms when handed off and its tmux ended; the
  // session it came from / went to; Claude effort for the next launch
  paused_at: number | null;
  handoff_from_session_id: string | null;
  handoff_to_session_id: string | null;
  effort: string | null;
}

/** What an agent tried on a session's permissions (lib/agent-actions.ts) */
export interface AgentActionRow {
  id: number;
  actor_session_id: string | null;
  actor_tmux: string | null;
  target_session_id: string;
  action: string;
  allowed: number; // 0 or 1
  detail: string | null;
  at: number; // ms
}

/** A message waiting for its session (migration 25, lib/queue/store.ts) */
export interface SessionQueueRow {
  id: number;
  session_id: string;
  position: number;
  text: string;
  /** JSON string[] of file paths, or null */
  attachments: string | null;
  origin: string; // lib/queue/types.ts QueueOrigin
  kind: string; // QueueKind
  status: string; // QueueStatus
  not_before: number | null; // ms
  created_at: number; // ms
  sent_at: number | null; // ms
  error: string | null;
}

/** One agent turn and its snapshot refs (migration 26, lib/turns.ts) */
export interface SessionTurnRow {
  id: number;
  session_id: string;
  turn_no: number;
  cwd: string;
  prompt_excerpt: string | null;
  transcript_uuid: string | null;
  /** refs/agent-os/<sessionId>/t<N>-pre; null when the snapshot overran */
  pre_ref: string | null;
  post_ref: string | null;
  started_at: number | null; // ms
  ended_at: number | null; // ms
  /** JSON TurnFile[]: every file changed in pre..post */
  files_json: string | null;
  /** JSON string[]: paths the agent's own edit tools touched */
  touched_json: string | null;
  added: number | null;
  removed: number | null;
  undone_at: number | null; // ms
}

export interface Group {
  path: string;
  name: string;
  expanded: boolean;
  sort_order: number;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  working_directory: string;
  agent_type: AgentType;
  default_model: string;
  initial_prompt: string | null;
  instructions: string | null;
  /** JSON list of Claude Code hooks (lib/project-context.ts ProjectHook) */
  hooks: string | null;
  /** Instructions sessions have suggested, waiting for the user (list API) */
  suggestions?: number;
  expanded: boolean;
  sort_order: number;
  is_uncategorized: boolean;
  git_sync_interval: number;
  /** Listed under Pinned on the Projects page (migration 24) */
  pinned: boolean;
  /** The user's own group on the Projects page ("iOS", "Home lab") */
  group_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDevServer {
  id: string;
  project_id: string;
  name: string;
  type: DevServerType;
  command: string;
  port: number | null;
  port_env_var: string | null;
  sort_order: number;
}

export interface ProjectRepository {
  id: string;
  project_id: string;
  name: string;
  path: string;
  is_primary: boolean;
  sort_order: number;
}

export interface Message {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string; // JSON array
  timestamp: string;
  duration_ms: number | null;
}

export interface ToolCall {
  id: number;
  message_id: number;
  session_id: string;
  tool_name: string;
  tool_input: string; // JSON
  tool_result: string | null; // JSON
  status: "pending" | "running" | "completed" | "error";
  timestamp: string;
}

export type DevServerType = "node" | "docker";
export type DevServerStatus = "stopped" | "starting" | "running" | "failed";

export interface DevServer {
  id: string;
  project_id: string;
  type: DevServerType;
  name: string;
  command: string;
  status: DevServerStatus;
  pid: number | null;
  container_id: string | null;
  ports: string; // JSON array of port numbers
  working_directory: string;
  created_at: string;
  updated_at: string;
}

// Store
export type StoreItemType = "skill" | "agent" | "mcp";
export type StoreSyncStatus = "pending" | "syncing" | "synced" | "error";

export interface StoreSource {
  id: string;
  repo: string;
  branch: string;
  type: "skill" | "agent";
  label: string;
  is_builtin: number; // 0 or 1
  last_synced_at: string | null;
  sync_status: StoreSyncStatus;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreItem {
  id: string;
  source_id: string | null;
  type: StoreItemType;
  dir_name: string;
  name: string;
  description: string;
  source_label: string;
  url: string;
  content_url: string;
  contents_url: string;
  raw_base: string;
  is_enriched: number; // 0 or 1
  mcp_version: string | null;
  mcp_registry_type: string | null;
  mcp_package_identifier: string | null;
  mcp_repo_url: string | null;
  mcp_env_vars: string | null; // JSON array
  download_files: string; // JSON array of {name, rawUrl}
  created_at: string;
  updated_at: string;
}
