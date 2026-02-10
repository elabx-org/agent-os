import { useState, useCallback, useEffect } from "react";
import type { FileNode } from "@/lib/file-utils";
import {
  type ExtensionItem,
  type ConfigScope,
  GLOBAL_SKILLS_DIR,
  GLOBAL_AGENTS_DIR,
  GLOBAL_CLAUDE_MD,
  projectSkillsDir,
  projectAgentsDir,
  projectClaudeMd,
  parseFrontmatter,
} from "../ClaudeConfigDialog.types";
import { updateFrontmatter } from "@/lib/frontmatter";

interface UseClaudeConfigOptions {
  open: boolean;
  projectPath?: string;
}

async function listDir(path: string): Promise<FileNode[]> {
  try {
    const res = await fetch(
      `/api/files?path=${encodeURIComponent(path)}&recursive=true`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.files || [];
  } catch {
    return [];
  }
}

async function readFile(path: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(path)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.isBinary) return null;
    return data.content ?? null;
  } catch {
    return null;
  }
}

async function writeFile(path: string, content: string): Promise<boolean> {
  try {
    const res = await fetch("/api/files/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteFileOrDir(path: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(path)}`,
      { method: "DELETE" }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Scan a directory for skills or agents
async function scanExtensions(
  dirPath: string,
  fileName: string, // "SKILL.md" or "AGENT.md"
  scope: ConfigScope
): Promise<ExtensionItem[]> {
  const nodes = await listDir(dirPath);
  const items: ExtensionItem[] = [];

  for (const node of nodes) {
    if (node.type !== "directory") continue;

    // Look for the target file in this subdirectory
    const targetFile = node.children?.find(
      (c) => c.type === "file" && c.name === fileName
    );
    if (!targetFile) continue;

    const content = await readFile(targetFile.path);
    if (content === null) continue;

    const { metadata } = parseFrontmatter(content);

    items.push({
      name: metadata.name || node.name,
      description: metadata.description || "",
      filePath: targetFile.path,
      dirPath: node.path,
      scope,
      content,
      source: metadata.source || "Manual",
    });
  }

  return items;
}

export function useClaudeConfig({ open, projectPath }: UseClaudeConfigOptions) {
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<ExtensionItem[]>([]);
  const [agents, setAgents] = useState<ExtensionItem[]>([]);
  const [globalClaudeMd, setGlobalClaudeMd] = useState<string | null>(null);
  const [projClaudeMd, setProjClaudeMd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Fetch all data when dialog opens
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);

      // Fetch skills
      const globalSkills = await scanExtensions(
        GLOBAL_SKILLS_DIR,
        "SKILL.md",
        "global"
      );
      const projSkills = projectPath
        ? await scanExtensions(
            projectSkillsDir(projectPath),
            "SKILL.md",
            "project"
          )
        : [];

      // Fetch agents
      const globalAgents = await scanExtensions(
        GLOBAL_AGENTS_DIR,
        "AGENT.md",
        "global"
      );
      const projAgents = projectPath
        ? await scanExtensions(
            projectAgentsDir(projectPath),
            "AGENT.md",
            "project"
          )
        : [];

      // Fetch CLAUDE.md files
      const gMd = await readFile(GLOBAL_CLAUDE_MD);
      const pMd = projectPath ? await readFile(projectClaudeMd(projectPath)) : null;

      if (cancelled) return;

      setSkills([...globalSkills, ...projSkills]);
      setAgents([...globalAgents, ...projAgents]);
      setGlobalClaudeMd(gMd);
      setProjClaudeMd(pMd);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, refreshKey]);

  const saveFile = useCallback(async (path: string, content: string) => {
    await writeFile(path, content);
  }, []);

  const createItem = useCallback(
    async (
      type: "skill" | "agent",
      scope: ConfigScope,
      name: string,
      content: string
    ) => {
      const baseDir =
        type === "skill"
          ? scope === "global"
            ? GLOBAL_SKILLS_DIR
            : projectSkillsDir(projectPath || "")
          : scope === "global"
            ? GLOBAL_AGENTS_DIR
            : projectAgentsDir(projectPath || "");

      const dirPath = `${baseDir}/${name}`;
      const fileName = type === "skill" ? "SKILL.md" : "AGENT.md";

      // writeFile creates parent directories automatically
      await writeFile(`${dirPath}/${fileName}`, content);
      refresh();
    },
    [projectPath, refresh]
  );

  const deleteItem = useCallback(
    async (dirPath: string) => {
      await deleteFileOrDir(dirPath);
      refresh();
    },
    [refresh]
  );

  const createClaudeMd = useCallback(
    async (scope: ConfigScope) => {
      const path =
        scope === "global"
          ? GLOBAL_CLAUDE_MD
          : projectClaudeMd(projectPath || "");
      // writeFile creates parent directories automatically
      await writeFile(path, "# CLAUDE.md\n\nProject instructions here.\n");
      refresh();
    },
    [projectPath, refresh]
  );

  const updateItemMetadata = useCallback(
    async (item: ExtensionItem, updates: Record<string, string>) => {
      const newContent = updateFrontmatter(item.content, updates);
      await writeFile(item.filePath, newContent);
      refresh();
    },
    [refresh]
  );

  return {
    loading,
    skills,
    agents,
    globalClaudeMd,
    projectClaudeMd: projClaudeMd,
    saveFile,
    createItem,
    deleteItem,
    createClaudeMd,
    updateItemMetadata,
    refresh,
  };
}
