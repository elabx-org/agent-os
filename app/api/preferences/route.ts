import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queries } from "@/lib/db/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "key parameter required" }, { status: 400 });
  }

  try {
    const row = queries.getPreference(db).get(key) as { value: string } | undefined;
    return NextResponse.json({ value: row ? JSON.parse(row.value) : null });
  } catch (error) {
    console.error("Error fetching preference:", error);
    return NextResponse.json({ error: "Failed to fetch preference" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    queries.upsertPreference(db).run(key, JSON.stringify(value));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error upserting preference:", error);
    return NextResponse.json({ error: "Failed to save preference" }, { status: 500 });
  }
}
