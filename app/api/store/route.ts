import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queries } from "@/lib/db/queries";
import type { StoreItem, StoreSource } from "@/lib/db/types";
import { isSyncing } from "@/lib/store-sync";

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "all";
  const search = request.nextUrl.searchParams.get("search")?.trim() || "";

  try {
    let items: StoreItem[];

    if (search) {
      const p = `%${search}%`;
      if (type === "all") {
        items = queries.searchStoreItems(db).all(p, p, p, p) as StoreItem[];
      } else {
        const dbType = type === "skills" ? "skill" : type === "agents" ? "agent" : "mcp";
        items = queries.searchStoreItemsByType(db).all(dbType, p, p, p, p) as StoreItem[];
      }
    } else if (type === "all") {
      items = queries.getAllStoreItems(db).all() as StoreItem[];
    } else {
      const dbType = type === "skills" ? "skill" : type === "agents" ? "agent" : "mcp";
      items = queries.getStoreItemsByType(db).all(dbType) as StoreItem[];
    }

    // Get counts
    const counts = queries.getStoreItemCounts(db).all() as Array<{
      type: string;
      count: number;
    }>;
    const countMap: Record<string, number> = {};
    for (const c of counts) countMap[c.type] = c.count;

    // Get last sync time
    const sources = queries.getStoreSources(db).all() as StoreSource[];
    const lastSynced = sources.reduce((latest, s) => {
      if (!s.last_synced_at) return latest;
      return !latest || s.last_synced_at > latest ? s.last_synced_at : latest;
    }, null as string | null);

    return NextResponse.json({
      items,
      total: items.length,
      syncStatus: {
        syncing: isSyncing(),
        lastSynced,
        counts: {
          skills: countMap["skill"] || 0,
          agents: countMap["agent"] || 0,
          mcps: countMap["mcp"] || 0,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load store" },
      { status: 500 }
    );
  }
}
