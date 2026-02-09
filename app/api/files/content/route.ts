import { NextRequest, NextResponse } from "next/server";
import { readFileContent, writeFileContent } from "@/lib/files";
import { rmSync } from "fs";

/**
 * GET /api/files/content?path=...
 * Read file contents
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory
    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    let result;
    try {
      result = readFileContent(expandedPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("ENOENT")) {
        return NextResponse.json(
          { error: "File not found", content: null, isBinary: false, size: 0, path: expandedPath },
          { status: 404 }
        );
      }
      throw err;
    }

    return NextResponse.json({
      ...result,
      path: expandedPath,
    });
  } catch (error) {
    console.error("Error reading file:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read file" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/files/content
 * Write file contents
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, content } = body;

    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    if (content === undefined) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory
    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    const result = writeFileContent(expandedPath, content);

    return NextResponse.json({
      ...result,
      path: expandedPath,
    });
  } catch (error) {
    console.error("Error writing file:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to write file",
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/files/content?path=...
 * Delete a file or directory
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory
    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    // Safety: refuse to delete critical paths
    const dangerous = ["/", "/home", "/root", "/etc", "/usr", "/var", "/bin", "/sbin"];
    if (dangerous.includes(expandedPath) || expandedPath === process.env.HOME) {
      return NextResponse.json(
        { error: "Refusing to delete critical system path" },
        { status: 403 }
      );
    }

    rmSync(expandedPath, { recursive: true, force: true });

    return NextResponse.json({ success: true, path: expandedPath });
  } catch (error) {
    console.error("Error deleting file:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete" },
      { status: 500 }
    );
  }
}
