import { NextRequest, NextResponse } from "next/server";
import { getDb, queries } from "@/lib/db";

// POST /api/sessions/pins - Save the order of a project's pinned sessions
export async function POST(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      return NextResponse.json(
        { error: "ids must be a list of session ids" },
        { status: 400 }
      );
    }
    const db = getDb();
    db.transaction(() => {
      ids.forEach((id, i) => queries.setSessionPinOrder(db).run(i + 1, id));
    })();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error ordering pinned sessions:", error);
    return NextResponse.json(
      { error: "Failed to order pinned sessions" },
      { status: 500 }
    );
  }
}
