"use client";

import {
  Bug,
  Clock,
  Database,
  File,
  FlaskConical,
  Globe,
  Monitor,
  Package,
  Play,
  RefreshCw,
  Rocket,
  SquareCheck,
  SquareTerminal,
  Stamp,
  Upload,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ScriptIcon as ScriptIconName } from "@/lib/project-config-types";
import { cn } from "@/lib/utils";

/** Each SCRIPT_ICONS name's lucide icon and tile colour (N-Scripts, D-Config) */
const ICONS: Record<ScriptIconName, { Icon: LucideIcon; tile: string }> = {
  monitor: { Icon: Monitor, tile: "bg-emerald-600 dark:bg-[#065F46]" },
  flask: { Icon: FlaskConical, tile: "bg-[#2563EB]" },
  check: { Icon: SquareCheck, tile: "bg-[#7C3AED]" },
  package: { Icon: Package, tile: "bg-[#C2410C]" },
  upload: { Icon: Upload, tile: "bg-[#52525B]" },
  terminal: { Icon: SquareTerminal, tile: "bg-zinc-700" },
  database: { Icon: Database, tile: "bg-cyan-700" },
  bug: { Icon: Bug, tile: "bg-red-700" },
  globe: { Icon: Globe, tile: "bg-sky-700" },
  refresh: { Icon: RefreshCw, tile: "bg-teal-700" },
  zap: { Icon: Zap, tile: "bg-yellow-700" },
  rocket: { Icon: Rocket, tile: "bg-pink-700" },
  stamp: { Icon: Stamp, tile: "bg-indigo-700" },
  file: { Icon: File, tile: "bg-slate-600" },
  play: { Icon: Play, tile: "bg-green-700" },
  clock: { Icon: Clock, tile: "bg-amber-700" },
};

function iconFor(icon: string | undefined) {
  return (icon && ICONS[icon as ScriptIconName]) || ICONS.terminal;
}

/**
 * M3 (U3.2): a script's icon tile (N-Scripts, N-Config, D-Config): the
 * lucide icon for a SCRIPT_ICONS name on its colour; unknown names draw
 * the terminal icon.
 */
export function ScriptIcon({
  icon,
  size = 40,
  className,
  plain = false,
}: {
  icon?: ScriptIconName | string;
  /** px, default 40 */
  size?: number;
  /** The glyph alone, in the text colour (D-Config's icon grid) */
  plain?: boolean;
  className?: string;
}) {
  const { Icon, tile } = iconFor(icon);
  if (plain)
    return (
      <Icon
        aria-hidden
        className={cn("flex-none", className)}
        style={{ width: size, height: size }}
        strokeWidth={1.9}
      />
    );
  // The mocks' .sq: a 30px tile has 8px corners and a 16px glyph
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
      }}
      className={cn(
        "flex flex-none items-center justify-center text-white",
        tile,
        className
      )}
    >
      <Icon
        style={{
          width: Math.round(size * 0.53),
          height: Math.round(size * 0.53),
        }}
        strokeWidth={1.9}
      />
    </span>
  );
}
