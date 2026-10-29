"use client";

/**
 * M3 (U3.2): N-Scripts. A sheet over the session (a dialog on desktop):
 * "Scripts · <project> · N running"; the running script's card (icon, port,
 * uptime, 3-line log tail, Stop, Show output, Open preview); rows with the
 * last run and play; "From .agent-os.json · Edit".
 */
export function ScriptsSheet(_props: {
  projectId: string;
  /** The session it opened over: its shell drawer runs terminal scripts */
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return null;
}

/** Mounted once in app/page.tsx: shows ScriptsSheet for stores/scriptsSheet */
export function ScriptsSheetHost() {
  return null;
}
