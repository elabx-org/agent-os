import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * POST /api/files/copy
 * Server-side file copy: copies a file from source to destinationDir.
 * Body: { source: string, destinationDir: string }
 */
export async function POST(request: Request) {
  try {
    const { source, destinationDir } = await request.json();

    if (!source || !destinationDir) {
      return NextResponse.json(
        { error: "source and destinationDir are required" },
        { status: 400 }
      );
    }

    const home = process.env.HOME || os.homedir();
    const expandedSource = source.replace(/^~/, home);
    const expandedDest = destinationDir.replace(/^~/, home);

    if (!fs.existsSync(expandedSource)) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    if (fs.statSync(expandedSource).isDirectory()) {
      return NextResponse.json(
        { error: "Source is a directory" },
        { status: 400 }
      );
    }

    if (!fs.existsSync(expandedDest)) {
      fs.mkdirSync(expandedDest, { recursive: true });
    }

    let destName = path.basename(expandedSource);
    let destPath = path.join(expandedDest, destName);

    // Deduplicate: file.txt → file(1).txt, file(2).txt, …
    if (fs.existsSync(destPath)) {
      const dotIdx = destName.lastIndexOf(".");
      const base = dotIdx > 0 ? destName.slice(0, dotIdx) : destName;
      const ext = dotIdx > 0 ? destName.slice(dotIdx) : "";
      let counter = 1;
      while (
        fs.existsSync(path.join(expandedDest, `${base}(${counter})${ext}`))
      ) {
        counter++;
      }
      destName = `${base}(${counter})${ext}`;
      destPath = path.join(expandedDest, destName);
    }

    fs.copyFileSync(expandedSource, destPath);

    return NextResponse.json({ path: destPath });
  } catch (error) {
    console.error("Copy error:", error);
    return NextResponse.json({ error: "Failed to copy file" }, { status: 500 });
  }
}
