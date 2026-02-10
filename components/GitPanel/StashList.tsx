"use client";

import { useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
  Trash2,
  Loader2,
  Plus,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiffView } from "@/components/DiffViewer/DiffModal";
import {
  useStashList,
  useStashSave,
  useStashAction,
  useStashDetail,
} from "@/data/git/queries";

interface StashListProps {
  workingDirectory: string;
}

export function StashList({ workingDirectory }: StashListProps) {
  const { data: stashes = [], isPending } = useStashList(workingDirectory);
  const saveMutation = useStashSave(workingDirectory);
  const actionMutation = useStashAction(workingDirectory);

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const handleSave = () => {
    saveMutation.mutate(
      { message: message.trim() || undefined, includeUntracked },
      {
        onSuccess: () => {
          setMessage("");
          setShowSaveForm(false);
        },
      }
    );
  };

  const handleAction = (index: number, action: "apply" | "pop" | "drop") => {
    actionMutation.mutate({ index, action });
  };

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Save stash form */}
      <div className="border-border/50 border-b p-3">
        {showSaveForm ? (
          <div className="space-y-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Stash message (optional)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setShowSaveForm(false);
              }}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={(e) => setIncludeUntracked(e.target.checked)}
                className="accent-primary h-3.5 w-3.5"
              />
              <span className="text-muted-foreground text-xs">
                Include untracked files
              </span>
            </label>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Archive className="mr-1 h-3 w-3" />
                )}
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSaveForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setShowSaveForm(true)}
          >
            <Plus className="mr-1 h-3 w-3" />
            Save Stash
          </Button>
        )}
      </div>

      {/* Stash list */}
      <div className="flex-1 overflow-y-auto">
        {stashes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8">
            <Package className="text-muted-foreground h-8 w-8 opacity-50" />
            <p className="text-muted-foreground text-sm">No stashes</p>
          </div>
        ) : (
          stashes.map((stash) => (
            <StashItem
              key={stash.index}
              stash={stash}
              workingDirectory={workingDirectory}
              expanded={expandedIndex === stash.index}
              onToggle={() =>
                setExpandedIndex(
                  expandedIndex === stash.index ? null : stash.index
                )
              }
              onAction={handleAction}
              actionPending={actionMutation.isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface StashItemProps {
  stash: { index: number; message: string; date: string; branch: string };
  workingDirectory: string;
  expanded: boolean;
  onToggle: () => void;
  onAction: (index: number, action: "apply" | "pop" | "drop") => void;
  actionPending: boolean;
}

function StashItem({
  stash,
  workingDirectory,
  expanded,
  onToggle,
  onAction,
  actionPending,
}: StashItemProps) {
  const { data: diff, isPending: diffLoading } = useStashDetail(
    workingDirectory,
    expanded ? stash.index : null
  );

  return (
    <div className="border-border/30 border-b">
      {/* Header */}
      <button
        className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-3 w-3 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{stash.message}</p>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {stash.branch && <span>on {stash.branch}</span>}
            {stash.date && (
              <span>
                {new Date(stash.date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Actions + Diff */}
      {expanded && (
        <div className="border-border/20 border-t px-3 py-2">
          <div className="mb-2 flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction(stash.index, "apply")}
              disabled={actionPending}
              title="Apply stash (keep in list)"
            >
              <Download className="mr-1 h-3 w-3" />
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction(stash.index, "pop")}
              disabled={actionPending}
              title="Pop stash (apply and remove)"
            >
              Pop
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction(stash.index, "drop")}
              disabled={actionPending}
              title="Drop stash"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Drop
            </Button>
          </div>

          {diffLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          ) : diff ? (
            <div className="max-h-64 overflow-auto rounded border">
              <DiffView diff={diff} fileName="stash" />
            </div>
          ) : (
            <p className="text-muted-foreground text-center text-xs">
              No changes in stash
            </p>
          )}
        </div>
      )}
    </div>
  );
}
