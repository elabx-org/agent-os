"use client";

import type { ScriptIcon as ScriptIconName } from "@/lib/project-config-types";

/**
 * M3 (U3.2): a script's icon tile (N-Scripts, N-Config, D-Config): the
 * lucide icon for a SCRIPT_ICONS name on its colour; unknown names draw
 * the terminal icon.
 */
export function ScriptIcon(_props: {
  icon?: ScriptIconName | string;
  /** px, default 40 */
  size?: number;
  className?: string;
}) {
  return null;
}
