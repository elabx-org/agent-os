import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

interface PluginJson {
  name: string;
  description?: string;
  version?: string;
  author?: { name?: string; email?: string };
  repository?: string;
  keywords?: string[];
  license?: string;
}

interface InstalledPlugin {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
  mcpServers?: Record<string, unknown>;
}

interface Marketplace {
  name: string;
  source: string;
  repo: string;
  installLocation: string;
}

export interface PluginInfo {
  name: string;
  description: string;
  author: string;
  marketplace: string;
  type: "internal" | "external";
  installed: boolean;
  enabled: boolean;
  version?: string;
  scope?: string;
  hasCommands: boolean;
  hasSkills: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
  repository?: string;
  keywords?: string[];
}

function getClaudePath(): string {
  const home = process.env.HOME || "/config";
  // Check common locations
  const paths = [
    `${home}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return "claude"; // fallback to PATH
}

function getInstalledPlugins(): InstalledPlugin[] {
  try {
    const claude = getClaudePath();
    const output = execSync(`${claude} plugin list --json`, {
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, HOME: process.env.HOME || "/config" },
    });
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function getMarketplaces(): Marketplace[] {
  try {
    const claude = getClaudePath();
    const output = execSync(`${claude} plugin marketplace list --json`, {
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, HOME: process.env.HOME || "/config" },
    });
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function scanPluginDir(
  dir: string,
  type: "internal" | "external",
  marketplace: string
): PluginInfo[] {
  if (!existsSync(dir)) return [];

  const plugins: PluginInfo[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = join(dir, entry.name);
      const metaPath = join(pluginDir, ".claude-plugin", "plugin.json");

      let meta: PluginJson = { name: entry.name };
      if (existsSync(metaPath)) {
        try {
          meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        } catch {
          // Use defaults
        }
      }

      plugins.push({
        name: meta.name || entry.name,
        description: meta.description || "",
        author: meta.author?.name || (type === "internal" ? "Anthropic" : "Unknown"),
        marketplace,
        type,
        installed: false,
        enabled: false,
        version: meta.version,
        hasCommands: existsSync(join(pluginDir, "commands")),
        hasSkills: existsSync(join(pluginDir, "skills")),
        hasAgents: existsSync(join(pluginDir, "agents")),
        hasMcp: existsSync(join(pluginDir, ".mcp.json")),
        repository: meta.repository,
        keywords: meta.keywords,
      });
    }
  } catch {
    // Ignore read errors
  }

  return plugins;
}

export async function GET() {
  try {
    const installed = getInstalledPlugins();
    const marketplaces = getMarketplaces();

    // Build map of installed plugins: "name@marketplace" -> InstalledPlugin
    const installedMap = new Map<string, InstalledPlugin>();
    for (const p of installed) {
      installedMap.set(p.id, p);
      // Also map by just the name part (before @)
      const name = p.id.split("@")[0];
      if (name) installedMap.set(name, p);
    }

    // Scan all marketplaces for available plugins
    const allPlugins: PluginInfo[] = [];

    for (const mp of marketplaces) {
      const internalDir = join(mp.installLocation, "plugins");
      const externalDir = join(mp.installLocation, "external_plugins");

      const internal = scanPluginDir(internalDir, "internal", mp.name);
      const external = scanPluginDir(externalDir, "external", mp.name);

      allPlugins.push(...internal, ...external);
    }

    // Merge installed state
    for (const plugin of allPlugins) {
      const key = `${plugin.name}@${plugin.marketplace}`;
      const inst = installedMap.get(key) || installedMap.get(plugin.name);
      if (inst) {
        plugin.installed = true;
        plugin.enabled = inst.enabled;
        plugin.version = inst.version || plugin.version;
        plugin.scope = inst.scope;
      }
    }

    // Add any installed plugins not found in marketplaces (e.g. from custom sources)
    for (const inst of installed) {
      const name = inst.id.split("@")[0];
      if (!allPlugins.some((p) => p.name === name)) {
        allPlugins.push({
          name: name || inst.id,
          description: "",
          author: "Unknown",
          marketplace: inst.id.split("@")[1] || "unknown",
          type: "external",
          installed: true,
          enabled: inst.enabled,
          version: inst.version,
          scope: inst.scope,
          hasCommands: false,
          hasSkills: false,
          hasAgents: false,
          hasMcp: !!inst.mcpServers && Object.keys(inst.mcpServers).length > 0,
        });
      }
    }

    return NextResponse.json({
      plugins: allPlugins,
      marketplaces: marketplaces.map((m) => ({
        name: m.name,
        source: m.source,
        repo: m.repo,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list plugins" },
      { status: 500 }
    );
  }
}
