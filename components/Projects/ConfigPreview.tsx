"use client";

import type { AgentOsConfig } from "@/lib/project-config-types";

/**
 * M3 (U3.3): D-Config's right panel: `.agent-os.json` as it will be saved,
 * line-numbered and highlighted, the lines that differ from the file on
 * disk marked "+N" in green with an "N lines to add" chip.
 */
export function ConfigPreview(_props: {
  /** The file's text on disk ("" when it doesn't exist) */
  base: string;
  /** What will be written */
  config: AgentOsConfig;
  className?: string;
}) {
  return null;
}
