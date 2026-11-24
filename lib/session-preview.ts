/**
 * The Preview of a session: the web servers it started (newest first), then
 * whatever else serves on this machine, which the person may pick instead
 */
export interface PreviewServer {
  port: number;
  name: string;
  sessionId: string | null;
  startedAt: number | null;
}

export function previewChoices<S extends PreviewServer>(
  servers: readonly S[],
  sessionId: string
): { mine: S[]; others: S[] } {
  const mine = servers
    .filter((s) => s.sessionId === sessionId)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.port - b.port);
  const others = servers
    .filter((s) => s.sessionId !== sessionId)
    .sort((a, b) => a.port - b.port);
  return { mine, others };
}

/** The server in front: the one picked while it still runs, else the session's newest */
export function previewShown<S extends PreviewServer>(
  choices: { mine: S[]; others: S[] },
  picked: number | null
): S | null {
  const all = [...choices.mine, ...choices.others];
  return all.find((s) => s.port === picked) ?? choices.mine[0] ?? null;
}

/** ":5173 node" */
export function previewLabel(server: { port: number; name: string }): string {
  return server.name ? `:${server.port} ${server.name}` : `:${server.port}`;
}

/** The port of the newest web server the session started; null with none */
export function sessionPort(
  servers: readonly PreviewServer[],
  sessionId: string | null | undefined
): number | null {
  if (!sessionId) return null;
  return previewChoices(servers, sessionId).mine[0]?.port ?? null;
}

/**
 * Where a session's Preview shows: in place of its views where the desktop
 * shell's header (or the Mac window's toolbar) holds the tab, and as the
 * Running page's own preview on a phone, the Duo and in the iOS app
 */
export function previewPlace(mode: string, native: boolean): "views" | "page" {
  return mode === "desktop" && !native ? "views" : "page";
}
