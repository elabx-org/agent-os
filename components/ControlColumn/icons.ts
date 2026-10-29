import {
  Activity,
  AlignLeft,
  ArrowRightLeft,
  Bell,
  Check,
  ChevronLeft,
  Circle,
  Code,
  Columns2,
  Ellipsis,
  Folder,
  GitBranch,
  Globe,
  Inbox,
  MessageSquare,
  Play,
  Plus,
  Search,
  Square,
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
  Check,
  ChevronLeft,
  Code,
  Columns2,
  Ellipsis,
  Folder,
  GitBranch,
  Globe,
  Inbox,
  MessageSquare,
  Play,
  Plus,
  Search,
  // The mocks' Settings: a circle with rays, not a cog
  Settings: Sun,
  Square,
  Terminal,
  Trash,
  X,
};

export function columnIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}
