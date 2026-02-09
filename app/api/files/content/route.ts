import { NextRequest, NextResponse } from "next/server";
import { readFileContent, writeFileContent } from "@/lib/files";

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
