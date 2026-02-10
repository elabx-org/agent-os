import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GitInfo } from "./NewSessionDialog.types";

export type BranchMode = "none" | "branch" | "worktree";

interface WorktreeSectionProps {
  gitInfo: GitInfo;
  branchMode: BranchMode;
  onBranchModeChange: (mode: BranchMode) => void;
  featureName: string;
  onFeatureNameChange: (value: string) => void;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
}

export function WorktreeSection({
  gitInfo,
  branchMode,
  onBranchModeChange,
  featureName,
  onFeatureNameChange,
  baseBranch,
  onBaseBranchChange,
}: WorktreeSectionProps) {
  if (!gitInfo.isGitRepo) return null;

  return (
    <div className="bg-accent/40 space-y-3 rounded-lg p-3">
      <p className="text-sm font-medium">Git Branch</p>
      <div className="space-y-1.5">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="branchMode"
            checked={branchMode === "none"}
            onChange={() => onBranchModeChange("none")}
            className="accent-primary h-3.5 w-3.5"
          />
          <span className="text-sm">Use current branch</span>
          {gitInfo.currentBranch && (
            <span className="text-muted-foreground text-xs">
              ({gitInfo.currentBranch})
            </span>
          )}
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="branchMode"
            checked={branchMode === "branch"}
            onChange={() => onBranchModeChange("branch")}
            className="accent-primary h-3.5 w-3.5"
          />
          <span className="text-sm">Create new branch</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="branchMode"
            checked={branchMode === "worktree"}
            onChange={() => onBranchModeChange("worktree")}
            className="accent-primary h-3.5 w-3.5"
          />
          <span className="text-sm">Create isolated worktree</span>
        </label>
      </div>

      {branchMode !== "none" && (
        <div className="space-y-3 pl-6">
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs">
              {branchMode === "worktree" ? "Feature Name" : "Branch Name"}
            </label>
            <Input
              value={featureName}
              onChange={(e) => onFeatureNameChange(e.target.value)}
              placeholder={
                branchMode === "worktree" ? "add-dark-mode" : "feature/my-change"
              }
              className="h-8 text-sm"
            />
            {featureName && branchMode === "worktree" && (
              <p className="text-muted-foreground text-xs">
                Branch: feature/
                {featureName
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
                  .slice(0, 50)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs">Base Branch</label>
            <Select value={baseBranch} onValueChange={onBaseBranchChange}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {gitInfo.branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
