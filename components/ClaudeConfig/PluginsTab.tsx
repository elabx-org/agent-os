"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import {
  Download,
  Loader2,
  Check,
  RefreshCw,
  Search,
  Power,
  PowerOff,
  Trash2,
  ArrowUpCircle,
  Terminal,
  BookOpen,
  Bot,
  Plug,
  Shield,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  usePlugins,
  usePluginAction,
  useSyncMarketplaces,
  type PluginInfo,
} from "@/data/plugins/queries";

type PluginFilter = "all" | "installed" | "available";

export function PluginsTab() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const { data, isLoading } = usePlugins();
  const actionMutation = usePluginAction();
  const syncMutation = useSyncMarketplaces();

  const plugins = data?.plugins || [];

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(value.trim().toLowerCase());
    }, 200);
  }, []);

  const filteredPlugins = useMemo(() => {
    let result = plugins;

    // Apply filter
    if (filter === "installed") {
      result = result.filter((p) => p.installed);
    } else if (filter === "available") {
      result = result.filter((p) => !p.installed);
    }

    // Apply search
    if (debouncedSearch) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(debouncedSearch) ||
          p.description.toLowerCase().includes(debouncedSearch) ||
          p.author.toLowerCase().includes(debouncedSearch) ||
          p.keywords?.some((k) => k.toLowerCase().includes(debouncedSearch))
      );
    }

    // Sort: installed first, then alphabetical
    return result.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [plugins, filter, debouncedSearch]);

  const installedCount = plugins.filter((p) => p.installed).length;
  const availableCount = plugins.filter((p) => !p.installed).length;

  const handleAction = useCallback(
    (name: string, action: "install" | "uninstall" | "enable" | "disable" | "update") => {
      actionMutation.mutate(
        { name, action },
        {
          onSuccess: () => {
            const labels: Record<string, string> = {
              install: "installed",
              uninstall: "uninstalled",
              enable: "enabled",
              disable: "disabled",
              update: "updated",
            };
            toast.success(`Plugin "${name}" ${labels[action]}`);
          },
          onError: (err) => {
            toast.error(err.message || `Failed to ${action} "${name}"`);
          },
        }
      );
    },
    [actionMutation]
  );

  const handleSync = useCallback(() => {
    syncMutation.mutate(undefined, {
      onSuccess: () => toast.success("Marketplace catalogs refreshed"),
      onError: (err) => toast.error(err.message || "Failed to refresh catalogs"),
    });
  }, [syncMutation]);

  if (isLoading && plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <p className="text-muted-foreground text-sm">Loading plugins...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search + Sync bar */}
      <div className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search plugins..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className="gap-1.5 whitespace-nowrap"
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              syncMutation.isPending && "animate-spin"
            )}
          />
          Refresh
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 px-3 pb-2">
        {(
          [
            { key: "all", label: "All", count: plugins.length },
            { key: "installed", label: "Installed", count: installedCount },
            { key: "available", label: "Available", count: availableCount },
          ] as const
        ).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {/* Plugin list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {filteredPlugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16">
            <Package className="text-muted-foreground h-8 w-8 opacity-50" />
            <p className="text-muted-foreground text-sm">
              {debouncedSearch ? "No plugins match your search" : "No plugins available"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredPlugins.map((plugin) => (
              <PluginCard
                key={`${plugin.name}@${plugin.marketplace}`}
                plugin={plugin}
                onAction={handleAction}
                acting={actionMutation.isPending}
                actingPlugin={
                  actionMutation.isPending
                    ? (actionMutation.variables?.name ?? null)
                    : null
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PluginCard({
  plugin,
  onAction,
  acting,
  actingPlugin,
}: {
  plugin: PluginInfo;
  onAction: (name: string, action: "install" | "uninstall" | "enable" | "disable" | "update") => void;
  acting: boolean;
  actingPlugin: string | null;
}) {
  const isActing = acting && actingPlugin === plugin.name;
  const pluginId = `${plugin.name}@${plugin.marketplace}`;

  return (
    <div
      className={cn(
        "border-border bg-card hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 transition-colors",
        plugin.installed && plugin.enabled && "border-primary/30"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          plugin.installed && plugin.enabled
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Plug className="h-4.5 w-4.5" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{plugin.name}</span>
          {plugin.installed && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                plugin.enabled
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Check className="h-2.5 w-2.5" />
              {plugin.enabled ? "Enabled" : "Disabled"}
            </span>
          )}
          {plugin.version && plugin.installed && (
            <span className="text-muted-foreground text-[10px]">
              v{plugin.version}
            </span>
          )}
        </div>

        {plugin.description && (
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
            {plugin.description}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-[10px]">
            {plugin.author}
          </span>
          <span className="text-muted-foreground/50 text-[10px]">·</span>
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[10px]",
              plugin.type === "internal"
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {plugin.type === "internal" ? "Official" : "Community"}
          </span>
          {/* Capability badges */}
          {plugin.hasCommands && (
            <span className="bg-muted text-muted-foreground inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px]">
              <Terminal className="h-2.5 w-2.5" />
              Commands
            </span>
          )}
          {plugin.hasSkills && (
            <span className="bg-muted text-muted-foreground inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px]">
              <BookOpen className="h-2.5 w-2.5" />
              Skills
            </span>
          )}
          {plugin.hasAgents && (
            <span className="bg-muted text-muted-foreground inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px]">
              <Bot className="h-2.5 w-2.5" />
              Agents
            </span>
          )}
          {plugin.hasMcp && (
            <span className="bg-muted text-muted-foreground inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px]">
              <Shield className="h-2.5 w-2.5" />
              MCP
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {isActing ? (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        ) : plugin.installed ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={plugin.enabled ? "Disable" : "Enable"}
              onClick={() =>
                onAction(pluginId, plugin.enabled ? "disable" : "enable")
              }
              disabled={acting}
            >
              {plugin.enabled ? (
                <PowerOff className="h-3.5 w-3.5" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Update"
              onClick={() => onAction(pluginId, "update")}
              disabled={acting}
            >
              <ArrowUpCircle className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive h-7 w-7"
              title="Uninstall"
              onClick={() => onAction(pluginId, "uninstall")}
              disabled={acting}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onAction(plugin.name, "install")}
            disabled={acting}
          >
            <Download className="h-3.5 w-3.5" />
            Install
          </Button>
        )}
      </div>
    </div>
  );
}
