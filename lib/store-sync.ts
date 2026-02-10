import { db } from "./db";
import { queries } from "./db/queries";
import type { StoreSource } from "./db/types";
import { ghApiJson, ghRawContent, ghFetch } from "./github";
import { parseFrontmatter } from "./frontmatter";
import { runInBackground } from "./async-operations";

const FETCH_CONCURRENCY = 3;
const ENRICH_BATCH_SIZE = 15;
const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const ENRICH_INTERVAL_MS = 10 * 1000; // 10 seconds between enrichment batches

let syncing = false;

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

// --- GitHub API types ---

interface GhDirEntry {
  name: string;
  type: string;
  url: string;
}

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
}

// --- Source sync: list directories → upsert stubs ---

async function syncStandardSource(source: StoreSource): Promise<string[]> {
  const API = `https://api.github.com/repos/${source.repo}/contents`;
  const branch = source.branch || "main";
  const RAW = `https://raw.githubusercontent.com/${source.repo}/${branch}`;
  const TREE = `https://github.com/${source.repo}/tree/${branch}`;
  const EXCLUDE = [".claude-plugin", ".github", "demos", "docs", "scripts"];
  const targetFile = source.type === "skill" ? "SKILL.md" : "AGENT.md";

  // Determine the subdirectory to list (anthropics/skills uses /skills subdirectory)
  let listUrl = API;
  let pathPrefix = "";
  if (source.id === "builtin-anthropic") {
    listUrl = `${API}/skills`;
    pathPrefix = "skills/";
  }

  const dirs = await ghApiJson<GhDirEntry[]>(listUrl);
  if (!dirs) return [];

  const upsert = queries.upsertStoreItem(db);
  const ids: string[] = [];

  for (const dir of dirs) {
    if (dir.type !== "dir" || EXCLUDE.includes(dir.name) || dir.name.startsWith(".")) continue;

    const id = source.is_builtin
      ? `${source.id.replace("builtin-", "")}-${dir.name}`
      : `custom-${source.id}-${dir.name}`;

    ids.push(id);
    upsert.run(
      id,                                              // id
      source.id,                                       // source_id
      source.type,                                     // type
      dir.name,                                        // dir_name
      "",                                              // name (enriched later)
      "",                                              // description
      source.label,                                    // source_label
      `${TREE}/${pathPrefix}${dir.name}`,              // url
      `${RAW}/${pathPrefix}${dir.name}/${targetFile}`, // content_url
      dir.url,                                         // contents_url
      `${RAW}/${pathPrefix}${dir.name}`,               // raw_base
      0,                                               // is_enriched
      null, null, null, null, null,                    // mcp fields
      "[]"                                             // download_files
    );
  }

  return ids;
}

async function syncVoltAgentSource(source: StoreSource): Promise<string[]> {
  const API = `https://api.github.com/repos/${source.repo}/contents`;
  const RAW = `https://raw.githubusercontent.com/${source.repo}/${source.branch}`;
  const TREE = `https://github.com/${source.repo}/tree/${source.branch}/categories`;

  const categories = await ghApiJson<GhDirEntry[]>(`${API}/categories`);
  if (!categories) return [];

  const upsert = queries.upsertStoreItem(db);
  const ids: string[] = [];

  await pMap(
    categories.filter((c) => c.type === "dir"),
    async (cat) => {
      const files = await ghApiJson<GhDirEntry[]>(cat.url);
      if (!files) return;

      for (const f of files) {
        if (f.type !== "file" || !f.name.endsWith(".md") || f.name === "README.md") continue;

        const agentName = f.name.replace(/\.md$/, "");
        const id = `voltagent-${agentName}`;
        ids.push(id);

        upsert.run(
          id,
          source.id,
          "agent",
          agentName,
          "",
          "",
          `VoltAgent / ${cat.name.replace(/^\d+-/, "")}`,
          `${TREE}/${cat.name}/${f.name}`,
          `${RAW}/categories/${cat.name}/${f.name}`,
          "",        // no contents_url for single-file agents
          "",        // no raw_base
          0,
          null, null, null, null, null,
          "[]"
        );
      }
    },
    FETCH_CONCURRENCY
  );

  return ids;
}

export async function syncSource(sourceId: string): Promise<void> {
  const source = queries.getStoreSource(db).get(sourceId) as StoreSource | undefined;
  if (!source) return;

  queries.updateStoreSourceSync(db).run("syncing", null, "syncing", source.id);

  try {
    let ids: string[];
    if (source.id === "builtin-voltagent") {
      ids = await syncVoltAgentSource(source);
    } else {
      ids = await syncStandardSource(source);
    }

    // Remove items that no longer exist in the source
    if (ids.length > 0) {
      queries.deleteStaleStoreItems(db).run(source.id, JSON.stringify(ids));
    }

    queries.updateStoreSourceSync(db).run("synced", null, "synced", source.id);
    console.log(`[Store Sync] ${source.label}: ${ids.length} items`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    queries.updateStoreSourceSync(db).run("error", msg, "error", source.id);
    console.error(`[Store Sync] ${source.label} failed:`, msg);
  }
}

// --- Enrichment: fetch SKILL.md/AGENT.md content ---

export async function enrichBatch(limit = ENRICH_BATCH_SIZE): Promise<number> {
  const items = queries.getUnenrichedStoreItems(db).all(limit) as Array<{
    id: string;
    content_url: string;
    type: string;
    dir_name: string;
  }>;

  if (items.length === 0) return 0;

  let enriched = 0;
  await pMap(
    items,
    async (item) => {
      const content = await ghRawContent(item.content_url);
      if (!content) return;

      const { metadata } = parseFrontmatter(content);
      const fileName = item.type === "agent" ? "AGENT.md" : "SKILL.md";

      // Update with enriched data
      db.prepare(
        `UPDATE store_items SET name = ?, description = ?, is_enriched = 1,
         download_files = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        metadata.name || item.dir_name,
        (metadata.description || "").replace(/\n/g, " ").trim(),
        JSON.stringify([{ name: fileName, rawUrl: item.content_url }]),
        item.id
      );
      enriched++;
    },
    FETCH_CONCURRENCY
  );

  if (enriched > 0) {
    console.log(`[Store Sync] Enriched ${enriched}/${items.length} items`);
  }
  return enriched;
}

// --- MCP Registry sync ---

export async function syncMcpRegistry(): Promise<void> {
  console.log("[Store Sync] Syncing MCP registry...");

  let cursor: string | undefined;
  let totalItems = 0;
  const upsert = queries.upsertStoreItem(db);

  try {
    do {
      const params = new URLSearchParams();
      params.set("limit", "100");
      params.set("version", "latest");
      if (cursor) params.set("cursor", cursor);

      const url = `https://registry.modelcontextprotocol.io/v0.1/servers?${params}`;

      let data: {
        servers: RegistryServer[];
        metadata: { nextCursor?: string; count: number };
      };

      try {
        const res = await ghFetch(url);
        if (!res.ok) throw new Error(`Registry returned ${res.status}`);
        data = await res.json();
      } catch {
        // If direct fetch fails, no fallback needed since this is server-side
        break;
      }

      for (const entry of data.servers) {
        const srv = entry.server;
        const pkg = srv.packages?.find(
          (p) =>
            (p.registryType === "npm" || p.registryType === "pypi") &&
            p.transport?.type === "stdio"
        );
        if (!pkg) continue;

        const envVars = (pkg.environmentVariables || []).map((ev) => ({
          name: ev.name,
          description: ev.description || "",
          isRequired: ev.isRequired ?? false,
          isSecret: ev.isSecret,
          defaultValue: ev.value,
        }));

        upsert.run(
          `mcp-${srv.name}-${srv.version}`,  // id
          null,                                 // source_id
          "mcp",                                // type
          srv.name,                             // dir_name
          srv.title || srv.name.split("/").pop() || srv.name, // name
          (srv.description || "").slice(0, 300),               // description
          "MCP Registry",                       // source_label
          srv.repository?.url || "",            // url
          "",                                   // content_url
          "",                                   // contents_url
          "",                                   // raw_base
          1,                                    // is_enriched (MCPs are always enriched)
          srv.version,                          // mcp_version
          pkg.registryType,                     // mcp_registry_type
          pkg.identifier,                       // mcp_package_identifier
          srv.repository?.url || null,          // mcp_repo_url
          JSON.stringify(envVars),              // mcp_env_vars
          "[]"                                  // download_files
        );
        totalItems++;
      }

      cursor = data.metadata.nextCursor;
    } while (cursor);

    console.log(`[Store Sync] MCP registry: ${totalItems} servers`);
  } catch (err) {
    console.error("[Store Sync] MCP registry failed:", err instanceof Error ? err.message : err);
  }
}

// --- Full sync orchestrator ---

export async function runFullSync(): Promise<void> {
  if (syncing) {
    console.log("[Store Sync] Already running, skipping");
    return;
  }

  syncing = true;
  console.log("[Store Sync] Starting full sync...");

  try {
    // Sync all sources in parallel (with concurrency limit)
    const sources = queries.getStoreSources(db).all() as StoreSource[];
    await pMap(
      sources,
      async (source) => syncSource(source.id),
      FETCH_CONCURRENCY
    );

    // Enrich first batch immediately
    await enrichBatch();

    // Sync MCP registry
    await syncMcpRegistry();

    console.log("[Store Sync] Full sync complete");
  } catch (err) {
    console.error("[Store Sync] Full sync failed:", err instanceof Error ? err.message : err);
  } finally {
    syncing = false;
  }
}

// --- Background enrichment loop ---

let enrichTimer: ReturnType<typeof setInterval> | null = null;

function startEnrichmentLoop(): void {
  if (enrichTimer) return;
  enrichTimer = setInterval(async () => {
    try {
      const count = await enrichBatch();
      if (count === 0 && enrichTimer) {
        // All items enriched, stop polling
        clearInterval(enrichTimer);
        enrichTimer = null;
      }
    } catch {
      // non-fatal
    }
  }, ENRICH_INTERVAL_MS);
}

// --- Scheduler ---

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleStoreSync(): void {
  // Initial sync after a short delay (don't block server startup)
  runInBackground(async () => {
    await runFullSync();
    startEnrichmentLoop();
  }, "store-initial-sync");

  // Periodic re-sync
  syncTimer = setInterval(() => {
    runInBackground(async () => {
      await runFullSync();
      startEnrichmentLoop();
    }, "store-periodic-sync");
  }, SYNC_INTERVAL_MS);
}

export function stopStoreSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (enrichTimer) {
    clearInterval(enrichTimer);
    enrichTimer = null;
  }
}

export function isSyncing(): boolean {
  return syncing;
}
