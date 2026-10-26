"use client";

import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";

interface Tab {
  id: string;
  sessionId: string | null;
  attachedTmux: string | null;
}

interface DesktopTabBarProps {
  tabs: Tab[];
  activeTabId: string;
  sessions: Session[];
  isFocused: boolean;
  onTabSwitch: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: () => void;
}

/**
 * The pane's tabs. One tab is the session the header already names, so the
 * strip only shows once there is a second (New tab is in the header's ⋯).
 */
export function DesktopTabBar({
  tabs,
  activeTabId,
  sessions,
  isFocused,
  onTabSwitch,
  onTabClose,
  onTabAdd,
}: DesktopTabBarProps) {
  if (tabs.length < 2) return null;

  const getTabName = (tab: Tab) => {
    if (tab.sessionId) {
      const s = sessions.find((sess) => sess.id === tab.sessionId);
      return s?.name || tab.attachedTmux || "Session";
    }
    if (tab.attachedTmux) return tab.attachedTmux;
    return "New Tab";
  };

  return (
    <div
      className={cn(
        "kb-compact-hide flex items-center gap-0.5 overflow-x-auto px-1 pt-1 transition-colors",
        isFocused ? "bg-muted" : "bg-muted/50"
      )}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={(e) => {
            e.stopPropagation();
            onTabSwitch(tab.id);
          }}
          className={cn(
            "group flex cursor-pointer items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs transition-colors",
            tab.id === activeTabId
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground/80 hover:bg-accent/50"
          )}
        >
          <span className="max-w-[120px] truncate">{getTabName(tab)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            className="hover:text-foreground ml-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onTabAdd();
            }}
            className="mx-1 h-6 w-6"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New tab</TooltipContent>
      </Tooltip>
    </div>
  );
}
