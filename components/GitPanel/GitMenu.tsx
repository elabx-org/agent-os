"use client";

import { ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PRSummary } from "@/lib/git-types";

export const SYNC_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 600, label: "Every 10 minutes" },
];

interface GitMenuProps {
  pr: PRSummary | null;
  syncInterval: number;
  onSyncInterval: (seconds: number) => void;
  onRefresh: () => void;
}

/** The git page's ⋯ by its title: refresh, fetch in the background, the PR on GitHub */
export function GitMenu({
  pr,
  syncInterval,
  onSyncInterval,
  onRefresh,
}: GitMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Git options"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex size-9 flex-none items-center justify-center rounded-full"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={onRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </DropdownMenuItem>
        {pr && (
          <DropdownMenuItem
            onSelect={() => window.open(pr.url, "_blank", "noopener")}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open #{pr.number} on GitHub
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
          Fetch in the background
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(syncInterval)}
          onValueChange={(v) => onSyncInterval(parseInt(v, 10) || 0)}
        >
          {SYNC_OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={String(o.value)}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
