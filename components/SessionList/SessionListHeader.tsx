import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, FolderPlus, FolderOpen } from "lucide-react";

interface SessionListHeaderProps {
  projectCount: number;
  onNewProject: () => void;
  onOpenProject: () => void;
}

/** The app's logo: a robot head */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

/** "PROJECTS · 11" over the list, with + for a new or existing project */
export function SessionListHeader({
  projectCount,
  onNewProject,
  onOpenProject,
}: SessionListHeaderProps) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 pt-1 pr-2 pl-4 text-[11.5px] font-semibold tracking-[.07em] uppercase">
      <span className="min-w-0 flex-1 truncate">Projects · {projectCount}</span>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Add project">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Add project</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onNewProject}>
            <FolderPlus className="mr-2 h-3 w-3" />
            New Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenProject}>
            <FolderOpen className="mr-2 h-3 w-3" />
            Open Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
