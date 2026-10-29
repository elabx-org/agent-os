import { NextRequest, NextResponse } from "next/server";
import { listDirectory, type FileNode } from "@/lib/files";
import { gitBadges, type FileGitBadges } from "@/lib/file-git-status";

/** Each entry's git letter, and `dirty` on folders with changes inside */
function withBadges(nodes: FileNode[], badges: FileGitBadges): FileNode[] {
  return nodes.map((node) => {
    const out: FileNode = { ...node };
    if (node.type === "directory") {
      if (badges.dirtyDirs.has(node.path)) out.dirty = true;
      if (node.children) out.children = withBadges(node.children, badges);
    } else {
      const badge = badges.files.get(node.path);
      if (badge) out.git = badge;
    }
    return out;
  });
}

/**
 * GET /api/files?path=...&recursive=true&git=1
 * List directory contents; with git=1, the entries' git badges
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");
    const recursive = searchParams.get("recursive") === "true";
    const withGit = searchParams.get("git") === "1";

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory
    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    const files = listDirectory(expandedPath, {
      recursive,
      maxDepth: recursive ? 2 : 1,
    });

    if (withGit) {
      const badges = await gitBadges(expandedPath);
      return NextResponse.json({
        files: withBadges(files, badges),
        path: expandedPath,
        // git status paths are from the repo's top: this maps them here
        gitPrefix: badges.prefix,
      });
    }

    return NextResponse.json({ files, path: expandedPath });
  } catch (error) {
    console.error("Error listing directory:", error);
    return NextResponse.json(
      { error: "Failed to list directory" },
      { status: 500 }
    );
  }
}
