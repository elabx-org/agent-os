export type ConfigTab = "skills" | "agents" | "claude-md";
export type ConfigScope = "global" | "project";

export interface ExtensionItem {
  name: string;
  description: string;
  filePath: string;
  dirPath: string;
  scope: ConfigScope;
  content: string;
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

export function projectSkillsDir(p: string) {
  return `${p}/.claude/skills`;
}
export function projectAgentsDir(p: string) {
  return `${p}/.claude/agents`;
}
export function projectClaudeMd(p: string) {
  return `${p}/.claude/CLAUDE.md`;
}

// Simple frontmatter parser — no YAML library needed
export function parseFrontmatter(content: string): {
  metadata: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };

  const metadata: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      metadata[key] = value;
    }
  }
  return { metadata, body: match[2] };
}

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
