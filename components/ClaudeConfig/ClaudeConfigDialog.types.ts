export type ConfigTab = "plugins" | "store" | "mcp-servers" | "skills" | "agents" | "claude-md";
export type ConfigScope = "global" | "project";

export interface ExtensionItem {
  name: string;
  description: string;
  filePath: string;
  dirPath: string;
  scope: ConfigScope;
  content: string;
  source: string;
}

export interface ClaudeConfigDialogProps {
  open: boolean;
  onClose: () => void;
  projectPath?: string;
}

// Path constants
export const GLOBAL_SKILLS_DIR = "~/.claude/skills";
export const GLOBAL_AGENTS_DIR = "~/.claude/agents";
export const GLOBAL_CLAUDE_MD = "~/.claude/CLAUDE.md";
export const STORE_SOURCES_PATH = "~/.claude/store-sources.json";

// MCP types
export interface McpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

// Custom store sources
export interface StoreSource {
  id: string;
  repo: string;
  type: "skill" | "agent";
  label: string;
  branch?: string;
}

export function projectSkillsDir(p: string) {
  return `${p}/.claude/skills`;
}
export function projectAgentsDir(p: string) {
  return `${p}/.claude/agents`;
}
export function projectClaudeMd(p: string) {
  return `${p}/.claude/CLAUDE.md`;
}

// Re-export from shared module (used by both client components and server-side sync)
export { parseFrontmatter } from "@/lib/frontmatter";

export const SKILL_TEMPLATE = `---
name: my-skill
description: What this skill does
allowed-tools: Bash, Read, Grep
---

# My Skill

Instructions for Claude when this skill is active.
`;

export const AGENT_TEMPLATE = `---
name: my-agent
description: What this agent does
---

# My Agent

Instructions for this agent.
`;
