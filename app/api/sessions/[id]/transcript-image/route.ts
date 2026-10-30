import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import readline from "readline";
import { queries, getDb, type Session } from "@/lib/db";
import { locateTranscript } from "@/lib/transcript-locate";

const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const UUID = /^[0-9a-f-]{36}$/i;

/** The transcript line of one entry, read until found */
async function findEntry(file: string, uuid: string): Promise<unknown | null> {
  const lines = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (!line.includes(uuid)) continue;
      try {
        const entry = JSON.parse(line) as { uuid?: string };
        if (entry.uuid === uuid) return entry;
      } catch {
        // A line still being written
      }
    }
  } finally {
    lines.close();
  }
  return null;
}

// GET /api/sessions/[id]/transcript-image?entry=<uuid>&n=<k> - A picture
// pasted into Claude Code: kept in the transcript itself (base64), shown
// where the chat would say "[image]"
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const entry = url.searchParams.get("entry") ?? "";
  const n = Number(url.searchParams.get("n") ?? 0);
  if (!UUID.test(entry) || !Number.isInteger(n) || n < 0) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  const found = session ? await locateTranscript(session) : null;
  if (!found?.file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const line = (await findEntry(found.file, entry).catch(() => null)) as {
    message?: { content?: unknown };
  } | null;
  const content = line?.message?.content;
  const images = Array.isArray(content)
    ? content.filter(
        (
          p
        ): p is {
          source: { type: string; media_type: string; data: string };
        } =>
          !!p &&
          typeof p === "object" &&
          (p as { type?: string }).type === "image"
      )
    : [];
  const image = images[n]?.source;
  if (!image || image.type !== "base64" || !TYPES.has(image.media_type)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(Buffer.from(image.data, "base64")), {
    headers: {
      "Content-Type": image.media_type,
      // A transcript entry never changes
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
