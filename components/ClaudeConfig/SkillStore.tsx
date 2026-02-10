"use client";

import { useState, useCallback, useMemo, useRef } from "react";
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
  type McpServerConfig,
} from "./ClaudeConfigDialog.types";
import { updateFrontmatter } from "@/lib/frontmatter";
import { McpInstallForm, installMcpServer } from "./McpInstallForm";
import { StoreSourceManager } from "./StoreSourceManager";
import type { StoreItem } from "@/lib/db/types";
import {
  useStoreItems,
  useStoreSources,
  useSyncStore,
  useAddStoreSource,
  useRemoveStoreSource,
} from "@/data/store";

// --- Types ---

type StoreFilter = "all" | "skills" | "agents" | "mcps";

interface SkillStoreProps {
  installedSkillNames: string[];
  installedAgentNames: string[];
  installedMcpIdentifiers: string[];
  onInstalled: () => void;
}

// --- GitHub proxy helpers (only used for install) ---

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

// --- Main Component ---

export function SkillStore({
  installedSkillNames,
  installedAgentNames,
  installedMcpIdentifiers,
  onInstalled,
}: SkillStoreProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StoreFilter>("all");
  const [installing, setInstalling] = useState<string | null>(null);
  const [mcpInstallTarget, setMcpInstallTarget] = useState<StoreItem | null>(null);
  const [mcpInstalling, setMcpInstalling] = useState(false);
  const [showSourceManager, setShowSourceManager] = useState(false);

  // Debounced search for API queries
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(value.trim());
    }, 300);
  }, []);

  // TanStack Query hooks — all data comes from local DB
  const apiType =
    filter === "all" ? "all" : filter === "skills" ? "skills" : filter === "agents" ? "agents" : "mcps";
  const { data: storeData, isLoading } = useStoreItems({
    type: apiType,
    search: debouncedSearch || undefined,
  });
  const { data: sourcesData } = useStoreSources();
  const syncMutation = useSyncStore();
  const addSourceMutation = useAddStoreSource();
  const removeSourceMutation = useRemoveStoreSource();

  const items = storeData?.items || [];
  const syncStatus = storeData?.syncStatus;
  const customSources = (sourcesData?.sources || []).filter((s) => !s.is_builtin);

  // Split items by type for display
  const skillAgentItems = useMemo(
    () => items.filter((i) => i.type !== "mcp"),
    [items]
  );
  const mcpItems = useMemo(
    () => items.filter((i) => i.type === "mcp"),
    [items]
  );

  const skillCount = syncStatus?.counts.skills || 0;
  const agentCount = syncStatus?.counts.agents || 0;
  const mcpCount = syncStatus?.counts.mcps || 0;

  // Install skill/agent
  const handleInstallSkillAgent = useCallback(
    async (item: StoreItem) => {
      setInstalling(item.id);
      try {
        const baseDir =
          item.type === "skill" ? GLOBAL_SKILLS_DIR : GLOBAL_AGENTS_DIR;
        const dirPath = `${baseDir}/${item.dir_name}`;

        // Parse download files from JSON
        let files: Array<{ name: string; rawUrl: string }> = [];
        try {
          files = JSON.parse(item.download_files || "[]");
        } catch {
          files = [];
        }

        // Resolve full file list at install time if we have a contents URL
        if (item.contents_url && item.raw_base) {
          const fileEntries = (await ghApiFetch(item.contents_url)) as Array<{
            name: string;
            type: string;
          }> | null;
          if (fileEntries) {
            files = fileEntries
              .filter((f) => f.type === "file")
              .map((f) => ({
                name: f.name,
                rawUrl: `${item.raw_base}/${f.name}`,
              }));
          }
        }

        for (const file of files) {
          let content = await fetchRaw(file.rawUrl);
          if (content) {
            // Inject source metadata into the main markdown file
            if (file.name === "SKILL.md" || file.name === "AGENT.md") {
              content = updateFrontmatter(content, {
                source: item.source_label || "Store",
              });
            }
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

        toast.success(`Installed "${item.name || item.dir_name}"`);
        onInstalled();
      } catch {
        toast.error(`Failed to install "${item.name || item.dir_name}"`);
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled]
  );

  // Install MCP server
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
    async (source: { repo: string; type: "skill" | "agent"; label: string; branch?: string }) => {
      await addSourceMutation.mutateAsync(source);
    },
    [addSourceMutation]
  );

  const handleRemoveSource = useCallback(
    async (id: string) => {
      await removeSourceMutation.mutateAsync(id);
    },
    [removeSourceMutation]
  );

  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <p className="text-muted-foreground text-sm">Loading store...</p>
      </div>
    );
  }

  if (items.length === 0 && !isLoading && !debouncedSearch) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <p className="text-muted-foreground text-sm">
          {syncStatus?.syncing
            ? "Syncing store data from GitHub..."
            : "Store is empty. Click refresh to sync."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncMutation.isPending && "animate-spin")} />
          {syncMutation.isPending ? "Syncing..." : "Sync now"}
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
                { key: "all" as const, label: "All" },
                { key: "skills" as const, label: `Skills (${skillCount})` },
                { key: "agents" as const, label: `Agents (${agentCount})` },
                { key: "mcps" as const, label: `MCPs (${mcpCount})` },
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

          {/* Sync status */}
          {syncStatus?.syncing && (
            <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Syncing
            </span>
          )}
          {syncStatus?.lastSynced && !syncStatus.syncing && (
            <span className="text-muted-foreground text-[10px]">
              {formatRelativeTime(syncStatus.lastSynced)}
            </span>
          )}

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowSourceManager(!showSourceManager)}
            title="Manage sources"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || syncStatus?.syncing}
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (syncMutation.isPending || syncStatus?.syncing) && "animate-spin")} />
          </Button>
        </div>

        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={
            filter === "mcps"
              ? "Search MCP servers..."
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
            sources={customSources.map((s) => ({
              id: s.id,
              repo: s.repo,
              type: s.type as "skill" | "agent",
              label: s.label,
              branch: s.branch,
            }))}
            onAdd={handleAddSource}
            onRemove={handleRemoveSource}
            onClose={() => setShowSourceManager(false)}
          />
        </div>
      )}

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Skills/Agents grid */}
        {filter !== "mcps" && skillAgentItems.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {skillAgentItems.map((item) => {
              const installedNames =
                item.type === "skill"
                  ? installedSkillNames
                  : installedAgentNames;
              const isInstalled = installedNames.includes(item.dir_name);
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
                      {item.name || item.dir_name}
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
                      {item.source_label}
                    </span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-[10px] transition-colors"
                      >
                        View <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                    <Button
                      variant={isInstalled ? "outline" : "default"}
                      size="sm"
                      className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                      disabled={isInstalling}
                      onClick={() => handleInstallSkillAgent(item)}
                    >
                      {isInstalling ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      {isInstalled
                        ? "Reinstall"
                        : isInstalling
                          ? "..."
                          : "Install"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* MCP section */}
        {showMcps && mcpItems.length > 0 && (
          <>
            {filter === "all" && skillAgentItems.length > 0 && (
              <div className="mb-2 mt-4">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  MCP Servers
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {mcpItems.map((item) => {
                const isInstalled = item.mcp_package_identifier
                  ? installedMcpIdentifiers.includes(item.mcp_package_identifier)
                  : false;
                const isTarget = mcpInstallTarget?.id === item.id;

                let envVars: Array<{
                  name: string;
                  description: string;
                  isRequired: boolean;
                  isSecret?: boolean;
                  defaultValue?: string;
                }> = [];
                try {
                  envVars = JSON.parse(item.mcp_env_vars || "[]");
                } catch {
                  envVars = [];
                }

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
                          item.mcp_registry_type === "npm"
                            ? "bg-orange-500/10 text-orange-500"
                            : "bg-sky-500/10 text-sky-500"
                        )}
                      >
                        {item.mcp_registry_type}
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
                      <span className="text-muted-foreground text-[10px]">
                        v{item.mcp_version}
                      </span>
                      {envVars.some((v) => v.isRequired) && (
                        <span className="text-muted-foreground text-[10px]">
                          {envVars.filter((v) => v.isRequired).length} required
                          env
                        </span>
                      )}
                      <div className="flex-1" />
                      {item.mcp_repo_url && (
                        <a
                          href={item.mcp_repo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-[10px] transition-colors"
                        >
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
                          serverName={(item.name || "")
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "")}
                          registryType={
                            (item.mcp_registry_type as "npm" | "pypi") || "npm"
                          }
                          packageIdentifier={
                            item.mcp_package_identifier || ""
                          }
                          envVars={envVars}
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
          </>
        )}

        {/* Empty state */}
        {skillAgentItems.length === 0 &&
          mcpItems.length === 0 &&
          !isLoading && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {debouncedSearch
                ? `No results for "${debouncedSearch}"`
                : "No items found"}
            </p>
          )}
      </div>
    </div>
  );
}

// --- Helpers ---

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
