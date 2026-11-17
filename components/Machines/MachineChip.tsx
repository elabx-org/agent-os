"use client";

import { Check, ChevronDown, Laptop, Server } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isOnline,
  useMachines,
  useTabMachine,
  useTabMachineId,
  type MachineView,
} from "@/data/machines";
import { switchMachine } from "@/lib/client/machine";
import { cn } from "@/lib/utils";

/** "Online" / "Offline" for a linked machine */
export const presenceWord = (m: MachineView) =>
  isOnline(m) ? "Online" : "Offline";

/**
 * Which machine the tab is on, when it isn't this server: a laptop glyph
 * and the name. Tapping it lists this server and each machine; picking one
 * reloads the app there. Nothing on this server.
 */
export function MachineChip({
  className,
  compact,
}: {
  className?: string;
  /** Just the glyph, where the row has no room for the name */
  compact?: boolean;
}) {
  if (!useTabMachineId()) return null;
  return <Chip className={className} compact={compact} />;
}

function Chip({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { id, machine } = useTabMachine();
  const { data } = useMachines();
  const linked = data?.machines.filter((m) => m.status === "approved") ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`On ${machine?.name ?? "another machine"}. Switch machine`}
          title={compact ? machine?.name : undefined}
          className={cn(
            "relative inline-flex h-7 max-w-[11rem] shrink-0 items-center gap-1 rounded-full bg-violet-500/15 pr-2 pl-2.5 text-[13px] font-semibold text-violet-700 after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] active:opacity-70 dark:text-violet-300",
            compact && "gap-0.5 pr-1.5 pl-2",
            className
          )}
        >
          <Laptop aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {!compact && (
            <span className="truncate">{machine?.name ?? "Mac"}</span>
          )}
          <ChevronDown
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 opacity-70"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <PickerItem
          icon={Server}
          name="This server"
          online
          current={!id}
          onSelect={() => switchMachine(null)}
        />
        {linked.map((m) => (
          <PickerItem
            key={m.id}
            icon={Laptop}
            name={m.name}
            online={isOnline(m)}
            current={m.id === id}
            onSelect={() => isOnline(m) && switchMachine(m.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PickerItem({
  icon: Icon,
  name,
  online,
  current,
  onSelect,
}: {
  icon: typeof Laptop;
  name: string;
  online: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={!online && !current}
      onSelect={current ? undefined : onSelect}
      className="flex min-h-11 items-center gap-2.5"
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              online ? "bg-work" : "bg-muted-foreground/50"
            )}
          />
          {online ? "Online" : "Offline"}
        </span>
      </span>
      {current && <Check aria-label="Current" className="h-4 w-4 shrink-0" />}
    </DropdownMenuItem>
  );
}
