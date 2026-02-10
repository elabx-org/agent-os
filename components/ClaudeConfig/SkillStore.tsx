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

/** Lightweight stub created from directory listing (no SKILL.md fetch needed) */
interface StoreItemStub {
  id: string;
  dirName: string;
  type: StoreItemType;
  source: string;
  url: string;
  /** URL to fetch SKILL.md or AGENT.md content from */
  contentUrl: string;
  /** GitHub Contents API URL to list all files (for install) */
  contentsUrl?: string;
  /** Base raw URL for constructing file download URLs */
  rawBase?: string;
}

/** Enriched item after fetching SKILL.md */
interface StoreItem extends StoreItemStub {
  name: string;
  description: string;
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

// --- Constants ---

const PAGE_SIZE = 12;
const FETCH_CONCURRENCY = 3;

// --- Concurrency limiter ---

async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

// --- GitHub helpers ---
// Always proxy through the server to use the cached gh auth token and avoid
// burning through GitHub's 60 req/hr unauthenticated rate limit.

async function ghApiFetch(url: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(
      `/api/github-raw?url=${encodeURIComponent(url)}`
    );
    if (res.ok) {
      const data = await res.json();
      return JSON.parse(data.content || "[]");
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/github-raw?url=${encodeURIComponent(url)}`
    );
    if (res.ok) {
      const data = await res.json();
      return data.content || null;
    }
  } catch {
    // ignore
  }
  return null;
}

// --- Phase 1: List directory stubs (cheap — 1 API call per source) ---

async function listAnthropicStubs(): Promise<StoreItemStub[]> {
  const API = "https://api.github.com/repos/anthropics/skills/contents";
  const RAW = "https://raw.githubusercontent.com/anthropics/skills/main";
  const TREE = "https://github.com/anthropics/skills/tree/main/skills";

  const dirs = (await ghApiFetch(`${API}/skills`)) as Array<{
    name: string;
    type: string;
    url: string;
  }> | null;
  if (!dirs) return [];

  return dirs
    .filter((d) => d.type === "dir")
    .map((dir) => ({
      id: `anthropic-${dir.name}`,
      dirName: dir.name,
      type: "skill" as const,
      source: "Anthropic",
      url: `${TREE}/${dir.name}`,
      contentUrl: `${RAW}/skills/${dir.name}/SKILL.md`,
      contentsUrl: dir.url,
      rawBase: `${RAW}/skills/${dir.name}`,
    }))
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

async function listDaymadeStubs(): Promise<StoreItemStub[]> {
  const API = "https://api.github.com/repos/daymade/claude-code-skills/contents";
  const RAW = "https://raw.githubusercontent.com/daymade/claude-code-skills/main";
  const TREE = "https://github.com/daymade/claude-code-skills/tree/main";
  const EXCLUDE = [".claude-plugin", ".github", "demos", "docs", "scripts"];

  const dirs = (await ghApiFetch(API)) as Array<{ name: string; type: string; url: string }> | null;
  if (!dirs) return [];

  return dirs
    .filter((d) => d.type === "dir" && !EXCLUDE.includes(d.name))
    .map((dir) => ({
      id: `daymade-${dir.name}`,
      dirName: dir.name,
      type: "skill" as const,
      source: "daymade",
      url: `${TREE}/${dir.name}`,
      contentUrl: `${RAW}/${dir.name}/SKILL.md`,
      contentsUrl: dir.url,
      rawBase: `${RAW}/${dir.name}`,
    }))
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

async function listVoltAgentStubs(): Promise<StoreItemStub[]> {
  const API = "https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/contents";
  const RAW = "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/main";
  const TREE = "https://github.com/VoltAgent/awesome-claude-code-subagents/tree/main/categories";

  const categories = (await ghApiFetch(`${API}/categories`)) as Array<{
    name: string;
    type: string;
    url: string;
  }> | null;
  if (!categories) return [];

  // Need to list files in each category (these are individual .md files, not dirs with SKILL.md)
  const stubs: StoreItemStub[] = [];
  await pMap(
    categories.filter((c) => c.type === "dir"),
    async (cat) => {
      const files = (await ghApiFetch(cat.url)) as Array<{ name: string; type: string }> | null;
      if (!files) return;
      for (const f of files) {
        if (f.type === "file" && f.name.endsWith(".md") && f.name !== "README.md") {
          const agentName = f.name.replace(/\.md$/, "");
          stubs.push({
            id: `voltagent-${agentName}`,
            dirName: agentName,
            type: "agent",
            source: `VoltAgent / ${cat.name.replace(/^\d+-/, "")}`,
            url: `${TREE}/${cat.name}/${f.name}`,
            contentUrl: `${RAW}/categories/${cat.name}/${f.name}`,
          });
        }
      }
    },
    FETCH_CONCURRENCY
  );
  return stubs.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

async function listCustomStubs(source: StoreSource): Promise<StoreItemStub[]> {
  const API = `https://api.github.com/repos/${source.repo}/contents`;
  const branch = source.branch || "main";
  const RAW = `https://raw.githubusercontent.com/${source.repo}/${branch}`;
  const TREE = `https://github.com/${source.repo}/tree/${branch}`;
  const targetFile = source.type === "skill" ? "SKILL.md" : "AGENT.md";

  const dirs = (await ghApiFetch(API)) as Array<{ name: string; type: string; url: string }> | null;
  if (!dirs) return [];

  return dirs
    .filter((d) => d.type === "dir" && !d.name.startsWith("."))
    .map((dir) => ({
      id: `custom-${source.id}-${dir.name}`,
      dirName: dir.name,
      type: source.type,
      source: source.label,
      url: `${TREE}/${dir.name}`,
      contentUrl: `${RAW}/${dir.name}/${targetFile}`,
      contentsUrl: dir.url,
      rawBase: `${RAW}/${dir.name}`,
    }))
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

// --- Phase 2: Enrich a batch of stubs by fetching SKILL.md/AGENT.md ---

async function enrichStubs(stubs: StoreItemStub[]): Promise<StoreItem[]> {
  const items: StoreItem[] = [];
  await pMap(
    stubs,
    async (stub) => {
      const content = await fetchRaw(stub.contentUrl);
      if (!content) return;
      const { metadata } = parseFrontmatter(content);
      const fileName = stub.type === "agent" ? "AGENT.md" : "SKILL.md";

      items.push({
        ...stub,
        name: metadata.name || stub.dirName,
        description: (metadata.description || "").replace(/\n/g, " ").trim(),
        downloadFiles: [{ name: fileName, rawUrl: stub.contentUrl }],
      });
    },
    FETCH_CONCURRENCY
  );
  return items;
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
      const proxyRes = await fetch(
        `/api/github-raw?url=${encodeURIComponent(url)}`
      );
      if (!proxyRes.ok) return { items: [] };
      const proxyData = await proxyRes.json();
      data = JSON.parse(proxyData.content || '{"servers":[],"metadata":{}}');
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
  // All stubs (directory listings — cheap to fetch)
  const [allStubs, setAllStubs] = useState<StoreItemStub[]>([]);
  // Enriched items (SKILL.md fetched — expensive, done in pages)
  const [items, setItems] = useState<StoreItem[]>([]);
  const [enrichedCount, setEnrichedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
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
  // Search-triggered enrichment
  const searchEnrichTimer = useRef<NodeJS.Timeout | null>(null);
  const enrichedIdsRef = useRef<Set<string>>(new Set());

  // Phase 1: List all directory stubs (cheap — ~4 API calls total)
  // Phase 2: Enrich first page of stubs (PAGE_SIZE API calls)
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setItems([]);
    setAllStubs([]);
    setEnrichedCount(0);

    try {
      const sources = await loadStoreSources();
      setCustomSources(sources);

      // Phase 1: list directories from all sources
      const [anthropic, daymade, voltagent, ...customResults] =
        await Promise.all([
          listAnthropicStubs().catch(() => []),
          listDaymadeStubs().catch(() => []),
          listVoltAgentStubs().catch(() => []),
          ...sources.map((s) => listCustomStubs(s).catch(() => [])),
        ]);

      const stubs = [
        ...anthropic,
        ...daymade,
        ...voltagent,
        ...customResults.flat(),
      ];

      if (stubs.length === 0) {
        setError(
          "Failed to load any items. GitHub may be rate-limiting requests."
        );
      }
      setAllStubs(stubs);

      // Phase 2: enrich only the first page
      const firstPage = stubs.slice(0, PAGE_SIZE);
      const enriched = await enrichStubs(firstPage);
      setItems(enriched);
      setEnrichedCount(PAGE_SIZE);
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

  // Load more skills/agents
  const handleLoadMore = useCallback(async () => {
    if (enriching || enrichedCount >= allStubs.length) return;
    setEnriching(true);
    try {
      const nextBatch = allStubs.slice(enrichedCount, enrichedCount + PAGE_SIZE);
      const enriched = await enrichStubs(nextBatch);
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const newItems = enriched.filter((i) => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });
      setEnrichedCount((prev) => prev + PAGE_SIZE);
    } catch {
      // non-fatal
    } finally {
      setEnriching(false);
    }
  }, [allStubs, enrichedCount, enriching]);

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

  // Keep enrichedIdsRef in sync with items
  useEffect(() => {
    enrichedIdsRef.current = new Set(items.map((i) => i.id));
  }, [items]);

  // Auto-enrich unenriched stubs that match the search query
  useEffect(() => {
    if (searchEnrichTimer.current) clearTimeout(searchEnrichTimer.current);
    if (!search.trim() || filter === "mcps") return;

    searchEnrichTimer.current = setTimeout(async () => {
      const q = search.toLowerCase();
      const unenrichedMatches = allStubs.filter(
        (stub) =>
          !enrichedIdsRef.current.has(stub.id) &&
          (stub.dirName.toLowerCase().includes(q) ||
            stub.source.toLowerCase().includes(q))
      );

      if (unenrichedMatches.length === 0) return;

      const batch = unenrichedMatches.slice(0, 20);
      setEnriching(true);
      try {
        const enriched = await enrichStubs(batch);
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const newItems = enriched.filter((i) => !existingIds.has(i.id));
          return [...prev, ...newItems];
        });
      } catch {
        // non-fatal
      } finally {
        setEnriching(false);
      }
    }, 300);

    return () => {
      if (searchEnrichTimer.current) clearTimeout(searchEnrichTimer.current);
    };
  }, [search, filter, allStubs]);

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

        // Resolve full file list at install time if we have a contents URL
        let files = item.downloadFiles;
        if (item.contentsUrl && item.rawBase) {
          const fileEntries = (await ghApiFetch(item.contentsUrl)) as Array<{ name: string; type: string }> | null;
          if (fileEntries) {
            files = fileEntries
              .filter((f) => f.type === "file")
              .map((f) => ({ name: f.name, rawUrl: `${item.rawBase}/${f.name}` }));
          }
        }

        for (const file of files) {
          const content = await fetchRaw(file.rawUrl);
          if (content) {
            await fetch("/api/files/content", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: `${dirPath}/${file.name}`, content }),
            });
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
          toast.error("Failed to install MCP server via claude mcp add");
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
          i.dirName.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.source.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, filter, search]);

  const skillCount = items.filter((i) => i.type === "skill").length;
  const agentCount = items.filter((i) => i.type === "agent").length;
  const hasMore = enrichedCount < allStubs.length;
  const remainingCount = Math.max(0, allStubs.length - enrichedCount);

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

        {/* Load more skills/agents */}
        {filter !== "mcps" && hasMore && !search.trim() && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={enriching}
              className="gap-1.5"
            >
              {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {enriching ? "Loading..." : `Load more (${remainingCount} remaining)`}
            </Button>
          </div>
        )}

        {/* Search enrichment indicator */}
        {filter !== "mcps" && search.trim() && enriching && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
            <span className="text-muted-foreground text-xs">Searching all items...</span>
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
