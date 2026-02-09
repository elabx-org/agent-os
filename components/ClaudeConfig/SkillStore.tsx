"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Download,
  Loader2,
  Check,
  ExternalLink,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  GLOBAL_SKILLS_DIR,
  GLOBAL_AGENTS_DIR,
  STORE_SOURCES_PATH,
  parseFrontmatter,
  type McpServerConfig,
  type StoreSource,
} from "./ClaudeConfigDialog.types";
import { McpInstallForm, installMcpServer } from "./McpInstallForm";
import { StoreSourceManager } from "./StoreSourceManager";

// --- Types ---

type StoreItemType = "skill" | "agent";
type StoreFilter = "all" | "skills" | "agents" | "mcps";

interface StoreItem {
  id: string;
  name: string;
  dirName: string;
  description: string;
  url: string;
  type: StoreItemType;
  source: string;
  downloadFiles: Array<{ name: string; rawUrl: string }>;
}

interface McpStoreItem {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  registryType: "npm" | "pypi";
  packageIdentifier: string;
  repoUrl?: string;
  envVars: Array<{
    name: string;
    description: string;
    isRequired: boolean;
    isSecret?: boolean;
    defaultValue?: string;
  }>;
}

interface SkillStoreProps {
  installedSkillNames: string[];
  installedAgentNames: string[];
  installedMcpIdentifiers: string[];
  onInstalled: () => void;
}

// --- GitHub helpers ---

async function ghApiFetch(url: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.ok) return res.json();

    if (res.status === 403 || res.status === 429) {
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

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (res.ok) return res.text();
  } catch {
    // ignore
  }
  return null;
}

// --- Built-in GitHub sources ---

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
        const content = await fetchRaw(`${RAW}/skills/${dir.name}/SKILL.md`);
        if (!content) return;
        const { metadata } = parseFrontmatter(content);

        let files = [{ name: "SKILL.md", rawUrl: `${RAW}/skills/${dir.name}/SKILL.md` }];
        try {
          const fileEntries = (await ghApiFetch(dir.url)) as Array<{ name: string; type: string }> | null;
          if (fileEntries) {
            files = fileEntries.filter((f) => f.type === "file").map((f) => ({
              name: f.name,
              rawUrl: `${RAW}/skills/${dir.name}/${f.name}`,
            }));
          }
        } catch { /* keep default */ }

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

async function fetchDaymadeSkills(): Promise<StoreItem[]> {
  const API = "https://api.github.com/repos/daymade/claude-code-skills/contents";
  const RAW = "https://raw.githubusercontent.com/daymade/claude-code-skills/main";
  const TREE = "https://github.com/daymade/claude-code-skills/tree/main";
  const EXCLUDE = [".claude-plugin", ".github", "demos", "docs", "scripts"];

  const dirs = (await ghApiFetch(API)) as Array<{ name: string; type: string; url: string }> | null;
  if (!dirs) return [];

  const items: StoreItem[] = [];
  await Promise.all(
    dirs
      .filter((d) => d.type === "dir" && !EXCLUDE.includes(d.name))
      .map(async (dir) => {
        const content = await fetchRaw(`${RAW}/${dir.name}/SKILL.md`);
        if (!content) return;
        const { metadata } = parseFrontmatter(content);

        let files = [{ name: "SKILL.md", rawUrl: `${RAW}/${dir.name}/SKILL.md` }];
        try {
          const fileEntries = (await ghApiFetch(dir.url)) as Array<{ name: string; type: string }> | null;
          if (fileEntries) {
            files = fileEntries.filter((f) => f.type === "file").map((f) => ({
              name: f.name,
              rawUrl: `${RAW}/${dir.name}/${f.name}`,
            }));
          }
        } catch { /* keep default */ }

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

async function fetchVoltAgentAgents(): Promise<StoreItem[]> {
  const API = "https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/contents";
  const RAW = "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/main";
  const TREE = "https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories";

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
        const files = (await ghApiFetch(cat.url)) as Array<{ name: string; type: string }> | null;
        if (!files) return;

        await Promise.all(
          files
            .filter((f) => f.type === "file" && f.name.endsWith(".md") && f.name !== "README.md")
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
                description: (metadata.description || "").replace(/\n/g, " ").trim(),
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

// --- Custom source fetcher ---

async function fetchCustomSource(source: StoreSource): Promise<StoreItem[]> {
  const API = `https://api.github.com/repos/${source.repo}/contents`;
  const branch = source.branch || "main";
  const RAW = `https://raw.githubusercontent.com/${source.repo}/${branch}`;
  const TREE = `https://github.com/${source.repo}/tree/${branch}`;
  const targetFile = source.type === "skill" ? "SKILL.md" : "AGENT.md";

  const dirs = (await ghApiFetch(API)) as Array<{ name: string; type: string; url: string }> | null;
  if (!dirs) return [];

  const items: StoreItem[] = [];
  await Promise.all(
    dirs
      .filter((d) => d.type === "dir" && !d.name.startsWith("."))
      .map(async (dir) => {
        const content = await fetchRaw(`${RAW}/${dir.name}/${targetFile}`);
        if (!content) return;
        const { metadata } = parseFrontmatter(content);

        let files = [{ name: targetFile, rawUrl: `${RAW}/${dir.name}/${targetFile}` }];
        try {
          const fileEntries = (await ghApiFetch(dir.url)) as Array<{ name: string; type: string }> | null;
          if (fileEntries) {
            files = fileEntries.filter((f) => f.type === "file").map((f) => ({
              name: f.name,
              rawUrl: `${RAW}/${dir.name}/${f.name}`,
            }));
          }
        } catch { /* keep default */ }

        items.push({
          id: `custom-${source.id}-${dir.name}`,
          name: metadata.name || dir.name,
          dirName: dir.name,
          description: (metadata.description || "").replace(/\n/g, " ").trim(),
          url: `${TREE}/${dir.name}`,
          type: source.type,
          source: source.label,
          downloadFiles: files,
        });
      })
  );
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Custom sources persistence ---

async function loadStoreSources(): Promise<StoreSource[]> {
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(STORE_SOURCES_PATH)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (data.isBinary || !data.content) return [];
    const parsed = JSON.parse(data.content);
    return parsed.sources || [];
  } catch {
    return [];
  }
}

async function saveStoreSources(sources: StoreSource[]): Promise<void> {
  await fetch("/api/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "mkdir -p ~/.claude" }),
  });
  await fetch("/api/files/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: STORE_SOURCES_PATH,
      content: JSON.stringify({ sources }, null, 2),
    }),
  });
}

// --- MCP Registry ---

interface RegistryServer {
  server: {
    name: string;
    title?: string;
    description?: string;
    version: string;
    repository?: { url?: string };
    packages?: Array<{
      registryType: string;
      identifier: string;
      transport: { type: string };
      environmentVariables?: Array<{
        name: string;
        description?: string;
        isRequired?: boolean;
        isSecret?: boolean;
        value?: string;
      }>;
    }>;
  };
  _meta?: Record<string, unknown>;
}

async function fetchMcpRegistry(
  search?: string,
  cursor?: string,
  limit = 50
): Promise<{ items: McpStoreItem[]; nextCursor?: string }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("version", "latest");
  if (search) params.set("search", search);
  if (cursor) params.set("cursor", cursor);

  const url = `https://registry.modelcontextprotocol.io/v0.1/servers?${params}`;

  let data: { servers: RegistryServer[]; metadata: { nextCursor?: string; count: number } };
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    data = await res.json();
  } catch {
    try {
      const proxyRes = await fetch("/api/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: `curl -fsSL '${url}'` }),
      });
      if (!proxyRes.ok) return { items: [] };
      const proxyData = await proxyRes.json();
      data = JSON.parse(proxyData.output || '{"servers":[],"metadata":{}}');
    } catch {
      return { items: [] };
    }
  }

  const items: McpStoreItem[] = [];
  for (const entry of data.servers) {
    const srv = entry.server;
    const pkg = srv.packages?.find(
      (p) =>
        (p.registryType === "npm" || p.registryType === "pypi") &&
        p.transport?.type === "stdio"
    );
    if (!pkg) continue;

    items.push({
      id: `mcp-${srv.name}-${srv.version}`,
      name: srv.name,
      title: srv.title || srv.name.split("/").pop() || srv.name,
      description: (srv.description || "").slice(0, 300),
      version: srv.version,
      registryType: pkg.registryType as "npm" | "pypi",
      packageIdentifier: pkg.identifier,
      repoUrl: srv.repository?.url,
      envVars: (pkg.environmentVariables || []).map((ev) => ({
        name: ev.name,
        description: ev.description || "",
        isRequired: ev.isRequired ?? false,
        isSecret: ev.isSecret,
        defaultValue: ev.value,
      })),
    });
  }

  return { items, nextCursor: data.metadata.nextCursor };
}

// --- Main Component ---

export function SkillStore({
  installedSkillNames,
  installedAgentNames,
  installedMcpIdentifiers,
  onInstalled,
}: SkillStoreProps) {
  // Skill/agent items
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StoreFilter>("all");

  // MCP items
  const [mcpItems, setMcpItems] = useState<McpStoreItem[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpNextCursor, setMcpNextCursor] = useState<string | undefined>();
  const [mcpInstallTarget, setMcpInstallTarget] = useState<McpStoreItem | null>(null);
  const [mcpInstalling, setMcpInstalling] = useState(false);

  // Custom sources
  const [customSources, setCustomSources] = useState<StoreSource[]>([]);
  const [showSourceManager, setShowSourceManager] = useState(false);

  // Debounce timer for MCP search
  const mcpSearchTimer = useRef<NodeJS.Timeout | null>(null);

  // Load skills/agents + initial MCPs
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const sources = await loadStoreSources();
      setCustomSources(sources);

      const [anthropic, daymade, voltagent, ...customResults] =
        await Promise.all([
          fetchAnthropicSkills().catch(() => []),
          fetchDaymadeSkills().catch(() => []),
          fetchVoltAgentAgents().catch(() => []),
          ...sources.map((s) => fetchCustomSource(s).catch(() => [])),
        ]);

      const all = [
        ...anthropic,
        ...daymade,
        ...voltagent,
        ...customResults.flat(),
      ];
      if (all.length === 0) {
        setError(
          "Failed to load any items. GitHub may be rate-limiting requests."
        );
      }
      setItems(all);
    } catch {
      setError("Failed to load store");
    } finally {
      setLoading(false);
    }

    // Also load MCPs
    setMcpLoading(true);
    try {
      const { items: mcps, nextCursor } = await fetchMcpRegistry();
      setMcpItems(mcps);
      setMcpNextCursor(nextCursor);
    } catch {
      // non-fatal
    } finally {
      setMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // MCP search with debounce
  useEffect(() => {
    if (filter !== "mcps") return;
    if (mcpSearchTimer.current) clearTimeout(mcpSearchTimer.current);

    mcpSearchTimer.current = setTimeout(async () => {
      setMcpLoading(true);
      try {
        const { items: mcps, nextCursor } = await fetchMcpRegistry(
          search.trim() || undefined
        );
        setMcpItems(mcps);
        setMcpNextCursor(nextCursor);
      } catch {
        // non-fatal
      } finally {
        setMcpLoading(false);
      }
    }, 300);

    return () => {
      if (mcpSearchTimer.current) clearTimeout(mcpSearchTimer.current);
    };
  }, [search, filter]);

  const handleLoadMoreMcps = useCallback(async () => {
    if (!mcpNextCursor) return;
    setMcpLoading(true);
    try {
      const { items: more, nextCursor } = await fetchMcpRegistry(
        search.trim() || undefined,
        mcpNextCursor
      );
      setMcpItems((prev) => [...prev, ...more]);
      setMcpNextCursor(nextCursor);
    } catch {
      // non-fatal
    } finally {
      setMcpLoading(false);
    }
  }, [mcpNextCursor, search]);

  const handleInstallSkillAgent = useCallback(
    async (item: StoreItem) => {
      setInstalling(item.id);
      try {
        const baseDir =
          item.type === "skill" ? GLOBAL_SKILLS_DIR : GLOBAL_AGENTS_DIR;
        const dirPath = `${baseDir}/${item.dirName}`;

        await fetch("/api/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: `mkdir -p '${dirPath}'` }),
        });

        for (const file of item.downloadFiles) {
          const res = await fetch("/api/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: `curl -fsSL '${file.rawUrl}'` }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.output && data.success) {
              await fetch("/api/files/content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: `${dirPath}/${file.name}`, content: data.output }),
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

  const handleInstallMcp = useCallback(
    async (name: string, config: McpServerConfig) => {
      setMcpInstalling(true);
      try {
        const ok = await installMcpServer(name, config);
        if (ok) {
          toast.success(`Installed MCP server "${name}"`);
          setMcpInstallTarget(null);
          onInstalled();
        } else {
          toast.error("Failed to write mcp.json");
        }
      } catch {
        toast.error("Failed to install MCP server");
      } finally {
        setMcpInstalling(false);
      }
    },
    [onInstalled]
  );

  // Custom sources CRUD
  const handleAddSource = useCallback(
    async (source: Omit<StoreSource, "id">) => {
      const newSource: StoreSource = {
        ...source,
        id: `src-${Date.now()}`,
      };
      const updated = [...customSources, newSource];
      await saveStoreSources(updated);
      setCustomSources(updated);
      // Reload to pick up new source items
      fetchAll();
    },
    [customSources, fetchAll]
  );

  const handleRemoveSource = useCallback(
    async (id: string) => {
      const updated = customSources.filter((s) => s.id !== id);
      await saveStoreSources(updated);
      setCustomSources(updated);
      fetchAll();
    },
    [customSources, fetchAll]
  );

  // Filtered items
  const filteredItems = useMemo(() => {
    let result = items;
    if (filter === "skills") result = result.filter((i) => i.type === "skill");
    if (filter === "agents") result = result.filter((i) => i.type === "agent");
    if (filter === "mcps") return []; // MCPs shown separately

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

  if (loading && mcpItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <p className="text-muted-foreground text-sm">Loading store...</p>
      </div>
    );
  }

  if (error && items.length === 0 && mcpItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchAll} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  const showMcps = filter === "all" || filter === "mcps";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-3 py-2">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {(
              [
                { key: "all" as const, label: `All` },
                { key: "skills" as const, label: `Skills (${skillCount})` },
                { key: "agents" as const, label: `Agents (${agentCount})` },
                { key: "mcps" as const, label: `MCPs (${mcpItems.length})` },
              ]
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
            onClick={() => setShowSourceManager(!showSourceManager)}
            title="Manage sources"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={fetchAll} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            filter === "mcps"
              ? "Search MCP registry..."
              : "Search skills, agents & MCPs..."
          }
          className="h-8 text-xs"
        />

        {/* Source links */}
        {filter !== "mcps" && (
          <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
            <a href="https://github.com/anthropics/skills" target="_blank" rel="noopener noreferrer" className="hover:text-foreground inline-flex items-center gap-0.5">
              anthropics/skills <ExternalLink className="h-2 w-2" />
            </a>
            <a href="https://github.com/daymade/claude-code-skills" target="_blank" rel="noopener noreferrer" className="hover:text-foreground inline-flex items-center gap-0.5">
              daymade/claude-code-skills <ExternalLink className="h-2 w-2" />
            </a>
            <a href="https://github.com/VoltAgent/awesome-claude-code-subagents" target="_blank" rel="noopener noreferrer" className="hover:text-foreground inline-flex items-center gap-0.5">
              VoltAgent/subagents <ExternalLink className="h-2 w-2" />
            </a>
            {filter === "all" && (
              <a href="https://registry.modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="hover:text-foreground inline-flex items-center gap-0.5">
                MCP Registry <ExternalLink className="h-2 w-2" />
              </a>
            )}
          </div>
        )}
        {filter === "mcps" && (
          <div className="text-muted-foreground mt-1.5 text-[10px]">
            <a href="https://registry.modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="hover:text-foreground inline-flex items-center gap-0.5">
              Official MCP Registry <ExternalLink className="h-2 w-2" />
            </a>
          </div>
        )}
      </div>

      {/* Source Manager */}
      {showSourceManager && (
        <div className="border-b p-3">
          <StoreSourceManager
            sources={customSources}
            onAdd={handleAddSource}
            onRemove={handleRemoveSource}
            onClose={() => setShowSourceManager(false)}
          />
        </div>
      )}

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Skills/Agents grid */}
        {filter !== "mcps" && filteredItems.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => {
              const installedNames =
                item.type === "skill" ? installedSkillNames : installedAgentNames;
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
                      <span className="bg-primary/10 text-primary flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px]">
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
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-[10px] transition-colors">
                      View <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <Button
                      variant={isInstalled ? "outline" : "default"}
                      size="sm"
                      className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                      disabled={isInstalling}
                      onClick={() => handleInstallSkillAgent(item)}
                    >
                      {isInstalling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      {isInstalled ? "Reinstall" : isInstalling ? "..." : "Install"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* MCP section */}
        {showMcps && (
          <>
            {filter === "all" && mcpItems.length > 0 && (
              <div className="mb-2 mt-4">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  MCP Servers
                </span>
              </div>
            )}

            {mcpLoading && mcpItems.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {mcpItems.map((item) => {
                  const isInstalled = installedMcpIdentifiers.includes(
                    item.packageIdentifier
                  );
                  const isTarget = mcpInstallTarget?.id === item.id;

                  return (
                    <div
                      key={item.id}
                      className="border-border hover:border-border/80 hover:bg-accent/50 flex flex-col rounded-lg border p-3 transition-colors"
                    >
                      <div className="mb-1 flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0 rounded bg-green-500/10 px-1 py-0.5 text-[10px] font-medium leading-none text-green-500">
                          MCP
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                            item.registryType === "npm"
                              ? "bg-orange-500/10 text-orange-500"
                              : "bg-sky-500/10 text-sky-500"
                          )}
                        >
                          {item.registryType}
                        </span>
                        <span className="text-sm font-medium leading-tight">
                          {item.title}
                        </span>
                        {isInstalled && (
                          <span className="bg-primary/10 text-primary flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px]">
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
                        <span className="text-muted-foreground text-[10px]">
                          v{item.version}
                        </span>
                        {item.envVars.some((v) => v.isRequired) && (
                          <span className="text-muted-foreground text-[10px]">
                            {item.envVars.filter((v) => v.isRequired).length} required env
                          </span>
                        )}
                        <div className="flex-1" />
                        {item.repoUrl && (
                          <a href={item.repoUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-[10px] transition-colors">
                            View <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                        <Button
                          variant={isInstalled ? "outline" : "default"}
                          size="sm"
                          className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                          onClick={() =>
                            setMcpInstallTarget(isTarget ? null : item)
                          }
                        >
                          <Download className="h-3 w-3" />
                          {isInstalled ? "Reinstall" : "Install"}
                        </Button>
                      </div>

                      {/* Install form */}
                      {isTarget && (
                        <div className="mt-2">
                          <McpInstallForm
                            serverName={item.title
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, "-")
                              .replace(/^-|-$/g, "")}
                            registryType={item.registryType}
                            packageIdentifier={item.packageIdentifier}
                            envVars={item.envVars}
                            onInstall={handleInstallMcp}
                            onCancel={() => setMcpInstallTarget(null)}
                            installing={mcpInstalling}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Load more MCPs */}
            {mcpNextCursor && !mcpLoading && (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMoreMcps}
                  className="gap-1.5"
                >
                  Load more MCPs
                </Button>
              </div>
            )}
            {mcpLoading && mcpItems.length > 0 && (
              <div className="mt-3 flex justify-center">
                <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {filteredItems.length === 0 &&
          (filter === "mcps" ? mcpItems.length === 0 : true) &&
          !loading &&
          !mcpLoading && (
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
