"use client";

import { Fragment, useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import type { ColumnItem as Item } from "@/lib/column-spec";
import { MORE_EVENT, runNav, type NavAction } from "@/lib/nav-actions";
import { isMacLike, shortcutKey } from "@/hooks/useViewShortcuts";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { mobileNavStore } from "@/stores/mobileNav";
import { focusStore } from "@/stores/focus";
import { gitMenuStore } from "@/stores/gitMenu";
import { moveSheetStore, openMoveSheet } from "@/stores/moveSheet";
import { useSurface } from "@/stores/surface";
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
import { SYNC_OPTIONS } from "@/components/GitPanel/GitMenu";
import { ColumnItem } from "./ColumnItem";
import { columnIcon } from "./icons";

/** Mac shows ⌘, everything else Ctrl; settled after mount to match the server render */
function useModKey(): string {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    if (!isMacLike()) setMod("Ctrl+");
  }, []);
  return mod;
}

/** Items that switch something on and off rather than go somewhere */
const TOGGLES: NavAction[] = ["live", "beside", "showFinished"];

interface ColumnItemsProps {
  items: Item[];
  orientation: "vertical" | "horizontal";
}

/** The spec's items as buttons, separators where it says, ⋯ as a menu */
export function ColumnItems({ items, orientation }: ColumnItemsProps) {
  const mod = useModKey();
  const hint = orientation === "vertical" ? "left" : "top";
  return items.map((item, i) => {
    const key = shortcutKey(item.id);
    // The bar's view showing: a tap shows the other one
    const other =
      item.selected && item.id === "chat"
        ? "terminal"
        : item.selected && item.id === "terminal"
          ? "chat"
          : null;
    const props = {
      icon: columnIcon(item.icon),
      label: item.label,
      shortcut: key ? `${mod}${key}` : undefined,
      selected: item.selected,
      badge: item.badge,
      badgeTone: item.badgeTone,
      prominent: item.prominent,
      danger: item.danger,
      bold: item.id === "back",
      toggle: TOGGLES.includes(item.id),
      ariaLabel: other
        ? `${item.label}, showing; show ${other}`
        : item.badge && item.badgeTone === "amber"
          ? `${item.label}, ${item.badge} waiting`
          : undefined,
      hint,
    } as const;
    return (
      <Fragment key={`${item.id}-${i}`}>
        {item.sep && i > 0 && (
          <span
            aria-hidden
            className={cn(
              "shrink-0 bg-black/10 dark:bg-white/14",
              orientation === "vertical" ? "my-1 h-px w-6" : "mx-1 h-6 w-px"
            )}
          />
        )}
        {item.id === "more" ? (
          <MoreMenu {...props} />
        ) : (
          <ColumnItem {...props} onClick={() => runNav(other ?? item.id)} />
        )}
      </Fragment>
    );
  });
}

type MoreProps = Omit<
  React.ComponentProps<typeof ColumnItem>,
  "onClick" | "ref"
>;

/**
 * ⋯: what the surface's column has no room for. Also opened by
 * runNav("more") (navStore.openMore's MORE_EVENT)
 */
function MoreMenu(props: MoreProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(MORE_EVENT, show);
    return () => window.removeEventListener(MORE_EVENT, show);
  }, []);
  const surface = useSurface();
  const mode = useLayoutMode();
  const { needsYou, liveOpen } = useSnapshot(mobileNavStore);
  const { on: focus } = useSnapshot(focusStore);
  const { actions: git } = useSnapshot(gitMenuStore);
  const { offer: movable } = useSnapshot(moveSheetStore);
  const inSession = surface === "session" || surface === "beside";
  const wide = mode === "duo-open" || mode === "book" || mode === "desktop";
  const go = (action: NavAction) => () => runNav(action);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <ColumnItem {...props} selected={open} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={props.hint === "left" ? "left" : "top"}
        align={props.hint === "left" ? "start" : "center"}
        className="w-56"
      >
        {git && (
          <>
            <DropdownMenuItem onSelect={() => git.refresh()}>
              Refresh
            </DropdownMenuItem>
            {git.prUrl && (
              <DropdownMenuItem
                onSelect={() => window.open(git.prUrl!, "_blank", "noopener")}
              >
                Open #{git.prNumber} on GitHub
              </DropdownMenuItem>
            )}
            <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
              Fetch in the background
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(git.syncInterval)}
              onValueChange={(v) => git.setSyncInterval(parseInt(v, 10) || 0)}
            >
              {SYNC_OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.value} value={String(o.value)}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {inSession && (
          <DropdownMenuItem onSelect={go("inbox")}>
            Needs you{needsYou > 0 && !focus ? ` (${needsYou})` : ""}
          </DropdownMenuItem>
        )}
        {surface === "now" && (
          <DropdownMenuItem onSelect={go("live")}>
            {liveOpen ? "Hide live activity" : "Live activity"}
          </DropdownMenuItem>
        )}
        {inSession && (
          <DropdownMenuItem onSelect={go("scripts")}>Scripts</DropdownMenuItem>
        )}
        {/* Over a session, or beside Now on a wide screen */}
        {movable && (inSession || (surface === "now" && wide)) && (
          <DropdownMenuItem onSelect={() => openMoveSheet(movable)}>
            Move to a worktree
          </DropdownMenuItem>
        )}
        {/* A session's column has no Find of its own (M11) */}
        {inSession && (
          <DropdownMenuItem onSelect={go("search")}>Find</DropdownMenuItem>
        )}
        {inSession && wide && surface !== "beside" && (
          <DropdownMenuItem onSelect={go("beside")}>
            Open beside
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={go("projects")}>Projects</DropdownMenuItem>
        <DropdownMenuItem onSelect={go("settings")}>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={go("focus")}>
          {focus ? "Leave Focus" : "Focus"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
