"use client";

import type { CSSProperties } from "react";

export interface ChangesPageProps {
  /** The session beside it: Commit and Discard act on its folder */
  sessionId: string;
  workingDirectory: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The open Duo's right page beside the conversation (Open-Changes): the
 * changed files with their counts, the selected file's diff, Discard and
 * Commit N files. The column's Changes opens it there (changesOpen) in
 * place of the git view taking both pages.
 */
export function ChangesPage({ className, style }: ChangesPageProps) {
  // M2b contract stub: U2b.5 builds the page
  return (
    <section aria-label="Changes" className={className} style={style}>
      <h2 className="t-title">Changes</h2>
    </section>
  );
}
