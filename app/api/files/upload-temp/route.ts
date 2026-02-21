import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(request: Request) {
  try {
    const { filename, base64, mimeType, destinationDir } = await request.json();

    if (!base64) {
      return NextResponse.json({ error: "No file data" }, { status: 400 });
    }

    let targetDir: string;
    let finalName: string;

    if (destinationDir) {
      // Save to specified directory (e.g. from file browser upload)
      targetDir = destinationDir.replace(/^~/, process.env.HOME || os.homedir());
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      // Keep the original filename, but deduplicate if needed
      const safeName =
        filename?.replace(/[^a-zA-Z0-9._-]/g, "_") || `file-${Date.now()}`;
      finalName = safeName;
      // If a file with that name already exists, add a numeric suffix
      if (fs.existsSync(path.join(targetDir, finalName))) {
        const dotIdx = finalName.lastIndexOf(".");
        const base = dotIdx > 0 ? finalName.slice(0, dotIdx) : finalName;
        const ext = dotIdx > 0 ? finalName.slice(dotIdx) : "";
        let counter = 1;
        while (fs.existsSync(path.join(targetDir, `${base}(${counter})${ext}`))) {
          counter++;
        }
        finalName = `${base}(${counter})${ext}`;
      }
    } else {
      // Save to temp directory (default — for image picker)
      targetDir = path.join(os.tmpdir(), "agent-os-screenshots");
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const ext = mimeType?.split("/")[1] || "png";
      const safeName =
        filename?.replace(/[^a-zA-Z0-9._-]/g, "_") || "screenshot";
      const uniqueName = `${Date.now()}-${safeName}`;
      finalName = uniqueName.endsWith(`.${ext}`)
        ? uniqueName
        : `${uniqueName}.${ext}`;
    }

    const filePath = path.join(targetDir, finalName);
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ path: filePath });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to save file" },
      { status: 500 }
    );
  }
}
