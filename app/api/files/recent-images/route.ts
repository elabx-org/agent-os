import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

const IMAGE = /\.(?:png|jpe?g|gif|webp|heic|heif|bmp)$/i;
const MAX = 24;

/**
 * The newest pictures uploaded from the app (agent-os-screenshots), for the
 * image picker's Recent row: a picture sent a while ago is a tap away
 */
export async function GET(request: Request) {
  const asked = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX) : 12;
  const dir = path.join(os.tmpdir(), "agent-os-screenshots");
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    // No upload so far
    return NextResponse.json({ images: [] });
  }
  const stats = await Promise.all(
    names
      .filter((name) => IMAGE.test(name))
      .map(async (name) => {
        const file = path.join(dir, name);
        try {
          const stat = await fs.promises.stat(file);
          return stat.isFile()
            ? { path: file, size: stat.size, mtime: stat.mtimeMs }
            : null;
        } catch {
          return null;
        }
      })
  );
  const images = stats
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return NextResponse.json({ images });
}
