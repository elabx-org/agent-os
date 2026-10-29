import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { getFlag } from "@/lib/flags";
import { getAllProjects } from "@/lib/projects";
import { expandHome, sessionCwd } from "@/lib/transcript-locate";
import { isSearchable } from "@/lib/search/sections";
import {
  searchCommands,
  searchFiles,
  searchMessages,
  searchSessions,
} from "@/lib/search/query";
import {
  SEARCH_KINDS,
  SEARCH_LIMITS,
  type SearchKind,
  type SearchMessageHit,
  type SearchResponse,
} from "@/lib/search/types";

/**
 * GET /api/search?q=&kind=all|sessions|messages|files|commands&projectId=
 * &sessionId= → SearchResponse (lib/search/types.ts). Only the sections
 * `kind` shows are computed ("all": every one), in parallel. Files are
 * searched in the project's folder, else the session's.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") || "").trim();
  const kindParam = searchParams.get("kind") || "all";
  if (!(SEARCH_KINDS as readonly string[]).includes(kindParam)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  const kind = kindParam as SearchKind;
  const projectId = searchParams.get("projectId") || null;
  const sessionId = searchParams.get("sessionId") || null;

  try {
    const response: SearchResponse = {
      query: q,
      sessions: [],
      messages: [],
      files: [],
      commands: [],
      messagesEnabled: getFlag("searchIndex"),
    };
    const sessions = queries.getAllSessions(getDb()).all() as Session[];
    const session = sessionId
      ? (sessions.find((s) => s.id === sessionId) ?? null)
      : null;
    if (session) response.sessionName = session.name;
    if (!isSearchable(q)) return NextResponse.json(response);

    const projects = getAllProjects();
    const project = projectId
      ? projects.find((p) => p.id === projectId && !p.is_uncategorized)
      : undefined;
    const filesRoot = project
      ? expandHome(project.working_directory)
      : session
        ? sessionCwd(session)
        : null;
    const wants = (section: SearchKind) => kind === "all" || kind === section;

    const [found, messages, files, commands] = await Promise.all([
      wants("sessions")
        ? searchSessions(
            q,
            sessions,
            new Map(projects.map((p) => [p.id, p.name])),
            SEARCH_LIMITS.sessions
          )
        : [],
      wants("messages")
        ? searchMessages(q, { limit: SEARCH_LIMITS.messages, sessions })
        : undefined,
      wants("files") && filesRoot
        ? searchFiles(q, filesRoot, SEARCH_LIMITS.files)
        : [],
      wants("commands")
        ? searchCommands(q, {
            session,
            projectId: project?.id ?? null,
            limit: SEARCH_LIMITS.commands,
          })
        : [],
    ]);

    response.sessions = found;
    response.files = files;
    response.commands = commands;
    if (messages !== undefined) {
      response.messagesEnabled = messages !== null;
      response.messages = (messages ?? []) as SearchMessageHit[];
    }
    return NextResponse.json(response);
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
