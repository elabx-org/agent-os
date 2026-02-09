"use client";

import { useState } from "react";
import {
  GitBranch,
  Check,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBranches, useCheckoutBranch } from "@/data/git/queries";

interface BranchSelectorProps {
  workingDirectory: string;
  currentBranch: string;
  hasChanges: boolean;
  onBranchChanged: () => void;
}

export function BranchSelector({
  workingDirectory,
  currentBranch,
  hasChanges,
  onBranchChanged,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);

  const { data: branchData, isLoading } = useBranches(workingDirectory, {
    enabled: open,
  });
  const checkoutMutation = useCheckoutBranch(workingDirectory);

  const handleSelect = (branch: string) => {
    if (branch === currentBranch) return;

    if (hasChanges) {
      setPendingBranch(branch);
      setOpen(false);
      return;
    }

    doCheckout(branch, false);
  };

  const doCheckout = (branch: string, force: boolean) => {
    checkoutMutation.mutate(
      { branch, force },
      {
        onSuccess: (data) => {
          if (data.dirty) {
            setPendingBranch(branch);
            return;
          }
          setPendingBranch(null);
          setOpen(false);
          onBranchChanged();
        },
      }
    );
  };

  const handleForceSwitch = () => {
    if (pendingBranch) {
      doCheckout(pendingBranch, true);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="bg-muted hover:bg-accent flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors"
            disabled={checkoutMutation.isPending}
          >
            {checkoutMutation.isPending ? (
              <Loader2 className="mr-0.5 h-3 w-3 animate-spin" />
            ) : (
              <GitBranch className="mr-0.5 h-3 w-3" />
            )}
            {currentBranch}
            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[300px] w-56 overflow-y-auto"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          ) : branchData?.branches.length === 0 ? (
            <div className="text-muted-foreground px-2 py-3 text-center text-xs">
              No branches found
            </div>
          ) : (
            branchData?.branches.map((branch) => (
              <DropdownMenuItem
                key={branch}
                onSelect={() => handleSelect(branch)}
                className="cursor-pointer"
              >
                <span className="flex-1 truncate text-sm">{branch}</span>
                {branch === currentBranch && (
                  <Check className="text-primary ml-2 h-3.5 w-3.5 flex-shrink-0" />
                )}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dirty working tree warning */}
      <Dialog
        open={!!pendingBranch}
        onOpenChange={(o) => !o && setPendingBranch(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Uncommitted Changes
            </DialogTitle>
            <DialogDescription>
              You have uncommitted changes. Switching to{" "}
              <span className="font-mono font-medium">{pendingBranch}</span> may
              cause conflicts or loss of work. Switch anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingBranch(null)}
              disabled={checkoutMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleForceSwitch}
              disabled={checkoutMutation.isPending}
            >
              {checkoutMutation.isPending ? "Switching..." : "Switch Branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
