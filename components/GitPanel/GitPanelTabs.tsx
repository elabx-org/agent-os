"use client";

import { cn } from "@/lib/utils";

export type GitTab = "changes" | "history" | "stash" | "pr";

interface GitPanelTabsProps {
  activeTab: GitTab;
  onTabChange: (tab: GitTab) => void;
  stashCount?: number;
  prNumber?: number;
}

export function GitPanelTabs({
  activeTab,
  onTabChange,
  stashCount,
  prNumber,
}: GitPanelTabsProps) {
  return (
    <div className="border-border/50 flex border-b">
      <TabButton
        active={activeTab === "changes"}
        onClick={() => onTabChange("changes")}
      >
        Changes
      </TabButton>
      <TabButton
        active={activeTab === "history"}
        onClick={() => onTabChange("history")}
      >
        History
      </TabButton>
      <TabButton
        active={activeTab === "stash"}
        onClick={() => onTabChange("stash")}
      >
        Stash
        {stashCount != null && stashCount > 0 && (
          <span className="bg-muted text-muted-foreground ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]">
            {stashCount}
          </span>
        )}
      </TabButton>
      {prNumber != null && (
        <TabButton
          active={activeTab === "pr"}
          onClick={() => onTabChange("pr")}
        >
          PR #{prNumber}
        </TabButton>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "text-foreground border-primary border-b-2"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
