import { NextResponse } from "next/server";
import { runFullSync, isSyncing } from "@/lib/store-sync";
import { runInBackground } from "@/lib/async-operations";

export async function POST() {
  if (isSyncing()) {
    return NextResponse.json({ status: "already_running" });
  }

  runInBackground(async () => {
    await runFullSync();
  }, "store-manual-sync");

  return NextResponse.json({ status: "started" });
}
