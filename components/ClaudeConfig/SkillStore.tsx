"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Download,
  Loader2,
  Check,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  GLOBAL_SKILLS_DIR,
  GLOBAL_AGENTS_DIR,
  parseFrontmatter,
} from "./ClaudeConfigDialog.types";

// --- Types ---

type StoreItemType = "skill" | "agent";

interface StoreItem {
  id: string; // unique key: source + name
  name: string;
  dirName: string;
  description: string;
  url: string;
  type: StoreItemType;
  source: string;
  // For downloading
  downloadFiles: Array<{ name: string; rawUrl: string }>;
}

interface SkillStoreProps {
  installedSkillNames: string[];
  installedAgentNames: string[];
  onInstalled: () => void;
}

// --- Sources ---

type StoreFilter = "all" | "skills" | "agents";

interface SourceConfig {
  id: string;
  label: string;
  repo: string;
  type: StoreItemType;
  fetchItems: () => Promise<StoreItem[]>;
}

// Helper: fetch GitHub API, fall back to server-side curl on rate limit
async function ghApiFetch(url: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.ok) return res.json();

    if (res.status === 403 || res.status === 429) {
      // Rate limited - use server proxy
      const proxyRes = await fetch("/api/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: `curl -fsSL '${url}' -H 'Accept: application/vnd.github.v3+json'`,
        }),
      });
      if (proxyRes.ok) {
        const data = await proxyRes.json();
        return JSON.parse(data.output || "[]");
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// Helper: fetch raw file content
async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (res.ok) return res.text();
  } catch {
    // ignore
  }
  return null;
}

// --- Source: Anthropic Official Skills ---
async function fetchAnthropicSkills(): Promise<StoreItem[]> {
  const API = "https://api.github.com/repos/anthropics/skills/contents";
  const RAW = "https://raw.githubusercontent.com/anthropics/skills/main";
  const TREE = "https://github.com/anthropics/skills/tree/main/skills";

  const dirs = (await ghApiFetch(`${API}/skills`)) as Array<{
    name: string;
    type: string;
    url: string;
  }> | null;
  if (!dirs) return [];

  const items: StoreItem[] = [];
  await Promise.all(
    dirs
      .filter((d) => d.type === "dir")
      .map(async (dir) => {
        const content = await fetchRaw(
          `${RAW}/skills/${dir.name}/SKILL.md`
        );
        if (!content) return;
        const { metadata } = parseFrontmatter(content);

        // Get file listing
        let files = [{ name: "SKILL.md", rawUrl: `${RAW}/skills/${dir.name}/SKILL.md` }];
        try {
          const fileEntries = (await ghApiFetch(dir.url)) as Array<{
            name: string;
            type: string;
          }> | null;
          if (fileEntries) {
            files = fileEntries
              .filter((f) => f.type === "file")
              .map((f) => ({
                name: f.name,
                rawUrl: `${RAW}/skills/${dir.name}/${f.name}`,
              }));
          }
        } catch {
          // keep default
        }

        items.push({
          id: `anthropic-${dir.name}`,
          name: metadata.name || dir.name,
          dirName: dir.name,
          description: (metadata.description || "").replace(/\n/g, " ").trim(),
          url: `${TREE}/${dir.name}`,
          type: "skill",
          source: "Anthropic",
          downloadFiles: files,
        });
      })
  );

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Source: daymade/claude-code-skills ---
async function fetchDaymadeSkills(): Promise<StoreItem[]> {
  const API = "https://api.github.com/repos/daymade/claude-code-skills/contents";
  const RAW = "https://raw.githubusercontent.com/daymade/claude-code-skills/main";
  const TREE = "https://github.com/daymade/claude-code-skills/tree/main";

  // Top-level dirs are skills (exclude non-skill dirs)
  const EXCLUDE = [".claude-plugin", ".github", "demos", "docs", "scripts"];

  const dirs = (await ghApiFetch(API)) as Array<{
    name: string;
    type: string;
    url: string;
  }> | null;
  if (!dirs) return [];

  const items: StoreItem[] = [];
  await Promise.all(
    dirs
      .filter((d) => d.type === "dir" && !EXCLUDE.includes(d.name))
      .map(async (dir) => {
        const content = await fetchRaw(`${RAW}/${dir.name}/SKILL.md`);
        if (!content) return;
        const { metadata } = parseFrontmatter(content);

        // Get file listing
        let files = [{ name: "SKILL.md", rawUrl: `${RAW}/${dir.name}/SKILL.md` }];
        try {
          const fileEntries = (await ghApiFetch(dir.url)) as Array<{
            name: string;
            type: string;
          }> | null;
          if (fileEntries) {
            files = fileEntries
              .filter((f) => f.type === "file")
              .map((f) => ({
                name: f.name,
                rawUrl: `${RAW}/${dir.name}/${f.name}`,
              }));
          }
        } catch {
          // keep default
        }

        items.push({
          id: `daymade-${dir.name}`,
          name: metadata.name || dir.name,
          dirName: dir.name,
          description: (metadata.description || "").replace(/\n/g, " ").trim(),
          url: `${TREE}/${dir.name}`,
          type: "skill",
          source: "daymade",
          downloadFiles: files,
        });
      })
  );

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Source: VoltAgent/awesome-claude-code-subagents ---
async function fetchVoltAgentAgents(): Promise<StoreItem[]> {
  const API =
    "https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/contents";
  const RAW =
    "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/main";
  const TREE =
    "https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories";

  // First get categories
  const categories = (await ghApiFetch(`${API}/categories`)) as Array<{
    name: string;
    type: string;
    url: string;
  }> | null;
  if (!categories) return [];

  const items: StoreItem[] = [];
  await Promise.all(
    categories
      .filter((c) => c.type === "dir")
      .map(async (cat) => {
        const files = (await ghApiFetch(cat.url)) as Array<{
          name: string;
          type: string;
        }> | null;
        if (!files) return;

        await Promise.all(
          files
            .filter(
              (f) =>
                f.type === "file" &&
                f.name.endsWith(".md") &&
                f.name !== "README.md"
            )
            .map(async (f) => {
              const agentName = f.name.replace(/\.md$/, "");
              const rawUrl = `${RAW}/categories/${cat.name}/${f.name}`;
              const content = await fetchRaw(rawUrl);
              if (!content) return;
              const { metadata } = parseFrontmatter(content);

              items.push({
                id: `voltagent-${agentName}`,
                name: metadata.name || agentName,
                dirName: agentName,
                description: (metadata.description || "")
                  .replace(/\n/g, " ")
                  .trim(),
                url: `${TREE}/${cat.name}/${f.name}`,
                type: "agent",
                source: `VoltAgent / ${cat.name.replace(/^\d+-/, "")}`,
                downloadFiles: [{ name: "AGENT.md", rawUrl }],
              });
            })
        );
      })
  );

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Main Component ---

export function SkillStore({
  installedSkillNames,
  installedAgentNames,
  onInstalled,
}: SkillStoreProps) {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StoreFilter>("all");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch all sources in parallel
      const [anthropic, daymade, voltagent] = await Promise.all([
        fetchAnthropicSkills().catch(() => []),
        fetchDaymadeSkills().catch(() => []),
        fetchVoltAgentAgents().catch(() => []),
      ]);

      const all = [...anthropic, ...daymade, ...voltagent];
      if (all.length === 0) {
        setError("Failed to load any items. GitHub may be rate-limiting requests.");
      }
      setItems(all);
    } catch {
      setError("Failed to load store");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleInstall = useCallback(
    async (item: StoreItem) => {
      setInstalling(item.id);

      try {
        const baseDir =
          item.type === "skill" ? GLOBAL_SKILLS_DIR : GLOBAL_AGENTS_DIR;
        const dirPath = `${baseDir}/${item.dirName}`;

        // Create directory
        await fetch("/api/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: `mkdir -p '${dirPath}'` }),
        });

        // Download files
        for (const file of item.downloadFiles) {
          const res = await fetch("/api/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: `curl -fsSL '${file.rawUrl}'` }),
          });

          if (res.ok) {
            const data = await res.json();
            const content = data.output || "";
            if (content && data.success) {
              await fetch("/api/files/content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  path: `${dirPath}/${file.name}`,
                  content,
                }),
              });
            }
          }
        }

        toast.success(`Installed "${item.name}"`);
        onInstalled();
      } catch {
        toast.error(`Failed to install "${item.name}"`);
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled]
  );

  const filteredItems = useMemo(() => {
    let result = items;

    if (filter === "skills") result = result.filter((i) => i.type === "skill");
    if (filter === "agents") result = result.filter((i) => i.type === "agent");

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.source.toLowerCase().includes(q)
      );
    }

    return result;
  }, [items, filter, search]);

  const skillCount = items.filter((i) => i.type === "skill").length;
  const agentCount = items.filter((i) => i.type === "agent").length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <p className="text-muted-foreground text-sm">
          Loading from 3 sources...
        </p>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <p className="text-destructive text-sm">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAll}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-3 py-2">
        <div className="mb-2 flex items-center gap-2">
          {/* Filter pills */}
          <div className="flex gap-1">
            {(
              [
                { key: "all", label: `All (${items.length})` },
                { key: "skills", label: `Skills (${skillCount})` },
                { key: "agents", label: `Agents (${agentCount})` },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={fetchAll}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills & agents..."
          className="h-8 text-xs"
        />

        {/* Source links */}
        <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
          <a
            href="https://github.com/anthropics/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-0.5"
          >
            anthropics/skills
            <ExternalLink className="h-2 w-2" />
          </a>
          <a
            href="https://github.com/daymade/claude-code-skills"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-0.5"
          >
            daymade/claude-code-skills
            <ExternalLink className="h-2 w-2" />
          </a>
          <a
            href="https://github.com/VoltAgent/awesome-claude-code-subagents"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-0.5"
          >
            VoltAgent/subagents
            <ExternalLink className="h-2 w-2" />
          </a>
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filteredItems.map((item) => {
            const installedNames =
              item.type === "skill"
                ? installedSkillNames
                : installedAgentNames;
            const isInstalled = installedNames.includes(item.dirName);
            const isInstalling = installing === item.id;

            return (
              <div
                key={item.id}
                className="border-border hover:border-border/80 hover:bg-accent/50 flex flex-col rounded-lg border p-3 transition-colors"
              >
                <div className="mb-1 flex items-start gap-1.5">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                      item.type === "skill"
                        ? "bg-blue-500/10 text-blue-500"
                        : "bg-purple-500/10 text-purple-500"
                    )}
                  >
                    {item.type === "skill" ? "Skill" : "Agent"}
                  </span>
                  <span className="text-sm font-medium leading-tight">
                    {item.name}
                  </span>
                  {isInstalled && (
                    <span className="bg-primary/10 text-primary flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-muted-foreground mb-1.5 line-clamp-2 flex-1 text-xs leading-relaxed">
                    {item.description}
                  </p>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground flex-1 truncate text-[10px]">
                    {item.source}
                  </span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-[10px] transition-colors"
                  >
                    View
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                  <Button
                    variant={isInstalled ? "outline" : "default"}
                    size="sm"
                    className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                    disabled={isInstalling}
                    onClick={() => handleInstall(item)}
                  >
                    {isInstalling ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {isInstalled ? "Reinstall" : isInstalling ? "..." : "Install"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {filteredItems.length === 0 && !loading && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {search.trim()
              ? `No results for "${search}"`
              : "No items found"}
          </p>
        )}
      </div>
    </div>
  );
}
