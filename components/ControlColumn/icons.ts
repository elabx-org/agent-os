import {
  Activity,
  AlignLeft,
  ArrowRightLeft,
  Bell,
  ChevronLeft,
  Circle,
  Columns2,
  Ellipsis,
  Folder,
  GitBranch,
  Globe,
  Inbox,
  MessageSquare,
  Plus,
  Search,
  Sun,
  Terminal,
  Trash,
  X,
  type LucideIcon,
} from "lucide-react";

/** The column spec's icon names (lib/column-spec.ts), as components */
const ICONS: Record<string, LucideIcon> = {
  Activity,
  AlignLeft,
  ArrowRightLeft,
  Bell,
  ChevronLeft,
  Columns2,
  Ellipsis,
  Folder,
  GitBranch,
  Globe,
  Inbox,
  MessageSquare,
  Plus,
  Search,
  // The mocks' Settings: a circle with rays, not a cog
  Settings: Sun,
  Terminal,
  Trash,
  X,
};

export function columnIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}
