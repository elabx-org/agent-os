"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useClaudeConfig } from "./hooks/useClaudeConfig";
import { useMcpConfig } from "./hooks/useMcpConfig";
import { useSkillInstaller } from "./hooks/useSkillInstaller";
import { ItemList } from "./ItemList";
import { ItemEditor } from "./ItemEditor";
import { InstallFromGitHub } from "./InstallFromGitHub";
import { ClaudeMdTab } from "./ClaudeMdTab";
import { SkillStore } from "./SkillStore";
import { PluginsTab } from "./PluginsTab";
import { McpServersTab } from "./McpServersTab";
import {
  type ConfigTab,
  type ExtensionItem,
  type ClaudeConfigDialogProps,
  SKILL_TEMPLATE,
  AGENT_TEMPLATE,
  GLOBAL_CLAUDE_MD,
  projectClaudeMd,
} from "./ClaudeConfigDialog.types";

const TABS: { key: ConfigTab; label: string }[] = [
  { key: "plugins", label: "Plugins" },
  { key: "store", label: "Store" },
  { key: "mcp-servers", label: "MCP Servers" },
  { key: "skills", label: "Skills" },
  { key: "agents", label: "Agents" },
  { key: "claude-md", label: "CLAUDE.md" },
];

export function ClaudeConfigDialog({
  open,
  onClose,
  projectPath,
}: ClaudeConfigDialogProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>("plugins");
  const [editingItem, setEditingItem] = useState<ExtensionItem | null>(null);
  const [showInstaller, setShowInstaller] = useState(false);

  const config = useClaudeConfig({ open, projectPath });
  const mcpConfig = useMcpConfig({ open, projectPath });
  const installer = useSkillInstaller({
    projectPath,
    onInstalled: () => {
      config.refresh();
      setShowInstaller(false);
    },
  });

  const hasProject = !!projectPath;

  // Installed directory names for the store to check
  const installedSkillNames = useMemo(
    () =>
      config.skills
        .filter((s) => s.scope === "global")
        .map((s) => {
          const parts = s.dirPath.split("/");
          return parts[parts.length - 1];
        }),
    [config.skills]
  );

  const installedAgentNames = useMemo(
    () =>
      config.agents
        .filter((a) => a.scope === "global")
        .map((a) => {
          const parts = a.dirPath.split("/");
          return parts[parts.length - 1];
        }),
    [config.agents]
  );

  // Installed MCP package identifiers for the store to check
  const installedMcpIdentifiers = useMemo(
    () =>
      mcpConfig.servers
        .map((s) => {
          const args = s.config.args || [];
          if (s.config.command === "npx") {
            const yIdx = args.indexOf("-y");
            return yIdx >= 0 ? args[yIdx + 1] || "" : args[0] || "";
          }
          if (s.config.command === "uvx") return args[0] || "";
          return "";
        })
        .filter(Boolean),
    [mcpConfig.servers]
  );

  const handleEdit = useCallback((item: ExtensionItem) => {
    setEditingItem(item);
  }, []);

  const handleBack = useCallback(() => {
    setEditingItem(null);
    config.refresh();
  }, [config]);

  const handleSaveItem = useCallback(
    async (content: string) => {
      if (!editingItem) return;
      await config.saveFile(editingItem.filePath, content);
    },
    [editingItem, config]
  );

  const handleDelete = useCallback(
    (item: ExtensionItem) => {
      config.deleteItem(item.dirPath);
    },
    [config]
  );

  const handleCreate = useCallback(
    (type: "skill" | "agent") =>
      (scope: "global" | "project", name: string) => {
        const template = type === "skill" ? SKILL_TEMPLATE : AGENT_TEMPLATE;
        const content = template.replace(/^name: .+$/m, `name: ${name}`);
        config.createItem(type, scope, name, content);
      },
    [config]
  );

  const handleUpdateMetadata = useCallback(
    (item: ExtensionItem, updates: Record<string, string>) => {
      config.updateItemMetadata(item, updates);
    },
    [config]
  );

  const handleTabChange = useCallback((tab: ConfigTab) => {
    setActiveTab(tab);
    setEditingItem(null);
    setShowInstaller(false);
  }, []);

  const handleClose = useCallback(() => {
    setEditingItem(null);
    setShowInstaller(false);
    setActiveTab("plugins");
    onClose();
  }, [onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-7xl sm:max-w-7xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-4 pt-4 pb-0">
          <DialogTitle>Claude Config</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="border-border/50 flex shrink-0 border-b">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={cn(
                "flex-1 px-4 py-2 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "text-foreground border-primary border-b-2"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Editing view */}
          {editingItem ? (
            <ItemEditor
              filePath={editingItem.filePath}
              initialContent={editingItem.content}
              onSave={handleSaveItem}
              onBack={handleBack}
            />
          ) : (
            <>
              {/* Plugins tab */}
              {activeTab === "plugins" && <PluginsTab />}

              {/* Store tab */}
              {activeTab === "store" && (
                <SkillStore
                  installedSkillNames={installedSkillNames}
                  installedAgentNames={installedAgentNames}
                  installedMcpIdentifiers={installedMcpIdentifiers}
                  onInstalled={() => {
                    config.refresh();
                    mcpConfig.refresh();
                  }}
                />
              )}

              {/* MCP Servers tab */}
              {activeTab === "mcp-servers" && (
                <McpServersTab open={open} projectPath={projectPath} />
              )}

              {/* Skills tab */}
              {activeTab === "skills" && (
                <>
                  {showInstaller && (
                    <div className="border-b p-3">
                      <InstallFromGitHub
                        hasProject={hasProject}
                        installing={installer.installing}
                        error={installer.error}
                        onInstall={installer.install}
                        onClose={() => {
                          setShowInstaller(false);
                          installer.clearError();
                        }}
                      />
                    </div>
                  )}
                  <ItemList
                    items={config.skills}
                    type="skill"
                    loading={config.loading}
                    hasProject={hasProject}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onCreate={handleCreate("skill")}
                    onUpdateMetadata={handleUpdateMetadata}
                    onInstallFromGitHub={() =>
                      setShowInstaller(!showInstaller)
                    }
                  />
                </>
              )}

              {/* Agents tab */}
              {activeTab === "agents" && (
                <>
                  {showInstaller && (
                    <div className="border-b p-3">
                      <InstallFromGitHub
                        hasProject={hasProject}
                        installing={installer.installing}
                        error={installer.error}
                        onInstall={installer.install}
                        onClose={() => {
                          setShowInstaller(false);
                          installer.clearError();
                        }}
                      />
                    </div>
                  )}
                  <ItemList
                    items={config.agents}
                    type="agent"
                    loading={config.loading}
                    hasProject={hasProject}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onCreate={handleCreate("agent")}
                    onUpdateMetadata={handleUpdateMetadata}
                    onInstallFromGitHub={() =>
                      setShowInstaller(!showInstaller)
                    }
                  />
                </>
              )}

              {/* CLAUDE.md tab */}
              {activeTab === "claude-md" && (
                <ClaudeMdTab
                  globalContent={config.globalClaudeMd}
                  projectContent={config.projectClaudeMd}
                  hasProject={hasProject}
                  loading={config.loading}
                  onSave={config.saveFile}
                  onCreate={config.createClaudeMd}
                  globalPath={GLOBAL_CLAUDE_MD}
                  projectPath={
                    projectPath ? projectClaudeMd(projectPath) : ""
                  }
                />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
