import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queries } from "@/lib/db/queries";
import type { StoreSource } from "@/lib/db/types";
import { syncSource } from "@/lib/store-sync";
import { runInBackground } from "@/lib/async-operations";

export async function GET() {
  try {
    const sources = queries.getStoreSources(db).all() as StoreSource[];
    return NextResponse.json({ sources });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load sources" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repo, type, label, branch } = body;

    if (!repo || !type) {
      return NextResponse.json(
        { error: "repo and type are required" },
        { status: 400 }
      );
    }

    const id = `custom-${Date.now()}`;
    queries.upsertStoreSource(db).run(
      id,
      repo,
      branch || "main",
      type,
      label || repo.split("/").pop() || repo,
      0 // not built-in
    );

    // Trigger sync for new source in background
    runInBackground(async () => {
      await syncSource(id);
    }, `store-sync-${id}`);

    const source = queries.getStoreSource(db).get(id) as StoreSource;
    return NextResponse.json({ source });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add source" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    // Delete items first (cascade should handle it, but be explicit)
    queries.deleteStoreItemsBySource(db).run(id);
    queries.deleteStoreSource(db).run(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete source" },
      { status: 500 }
    );
  }
}
