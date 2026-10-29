"use client";

import type { ProjectWithDevServers } from "@/lib/projects";

/**
 * M3 (U3.2): the project page's Scripts section, between Running and
 * Merged today: running scripts first, then each script with its last run
 * and play; "From .agent-os.json · Edit". Nothing for a project with no
 * scripts and no file.
 */
export function ProjectScripts(_props: { project: ProjectWithDevServers }) {
  return null;
}
