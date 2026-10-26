"use client";

import { Fragment, useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import {
  Focus,
  FolderOpen,
  GitBranch,
  Inbox,
  MessageSquare,
  Plus,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { runNav } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";
import { focusStore } from "@/stores/focus";
import { settingsPageStore } from "@/stores/settingsPage";
import { newSurfaceStore } from "@/stores/newSurface";
import { workspacePageStore } from "@/stores/workspacePage";
import { isMacLike } from "@/hooks/useViewShortcuts";
import { ColumnItem, type ColumnItemProps } from "./ColumnItem";

/** Width of the column capsule */
export const COLUMN_WIDTH = 54;
/** Height of the bar above the home indicator's safe area */
const BAR_HEIGHT = 52;
/** Clear of the camera and the clock/status glyphs at the top of the Duo's column */
const SIDE_RAIL_TOP = 136;
// A docked keyboard takes well over this; browser chrome resizing doesn't
const KEYBOARD_MIN_HEIGHT = 150;

/** Mac shows ⌘, everything else Ctrl; settled after mount to match the server render */
function useModKey(): string {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    if (!isMacLike()) setMod("Ctrl+");
  }, []);
  return mod;
}

const isTextInput = (el: Element | null) =>
  !!el &&
  el.getAttribute("inputmode") !== "none" &&
  (el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" &&
      !["button", "checkbox", "radio", "submit"].includes(
        (el as HTMLInputElement).type
      )) ||
    (el as HTMLElement).isContentEditable);

/**
 * Whether an on-screen keyboard is up: a text input has focus and the visual
 * viewport shrank. xterm focuses itself on load without a keyboard, so focus
 * alone isn't enough.
 */
function useKeyboardUp(enabled: boolean): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    // Viewport height with no keyboard, per width (rotation and fold change it)
    const baselines = new Map<number, number>();
    const update = () => {
      const width = window.innerWidth;
      const focused = isTextInput(document.activeElement);
      if (!focused) baselines.set(width, vv.height);
      const baseline = baselines.get(width) ?? window.innerHeight;
      setUp(focused && baseline - vv.height >= KEYBOARD_MIN_HEIGHT);
    };
    // The keyboard finishes sliding after focus moves
    const updateSoon = () => {
      update();
      setTimeout(update, 300);
    };
    update();
    vv.addEventListener("resize", update);
    document.addEventListener("focusin", updateSoon);
    document.addEventListener("focusout", updateSoon);
    return () => {
      vv.removeEventListener("resize", update);
      document.removeEventListener("focusin", updateSoon);
      document.removeEventListener("focusout", updateSoon);
    };
  }, [enabled]);
  return enabled && up;
}

interface ControlColumnProps {
  /**
   * column: a vertical capsule, placed by the parent (or by sideRailWidth);
   * bar: across the bottom of a phone, without Settings (it's in the header ⋯)
   */
  variant: "column" | "bar";
  /**
   * The iPhone Duo's right-hand system column in a browser: the capsule is
   * fixed in it, under the status glyphs, and stays above a docked keyboard
   */
  sideRailWidth?: number;
  className?: string;
}

/** The one view switcher: New, Inbox / views / Find, Focus, Settings */
export function ControlColumn({
  variant,
  sideRailWidth,
  className,
}: ControlColumnProps) {
  const {
    viewMode: paneView,
    needsYou,
    changes,
    inboxOpen,
    homeOpen,
  } = useSnapshot(mobileNavStore);
  const { open: newDialogOpen } = useSnapshot(newSurfaceStore);
  const { page } = useSnapshot(workspacePageStore);
  const newOpen = newDialogOpen || page?.kind === "new";
  // Over the home, or under New, no session view is showing
  const viewMode = homeOpen || newOpen ? null : paneView;
  const { on: focus } = useSnapshot(focusStore);
  const { open: settingsOpen } = useSnapshot(settingsPageStore);
  const mod = useModKey();
  const bar = variant === "bar";
  const sideRail = !bar && !!sideRailWidth;
  const keyboardUp = useKeyboardUp(bar);

  // Stay above a docked keyboard: it covers the system column too
  const [maxHeight, setMaxHeight] = useState<number | undefined>();
  useEffect(() => {
    const vv = window.visualViewport;
    if (!sideRail || !vv) return;
    const update = () =>
      setMaxHeight(Math.max(120, vv.height - SIDE_RAIL_TOP - 8));
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, [sideRail]);

  // Fixed layers such as the home stop short of the bar with this; the
  // pane above it needn't keep clear of the home indicator, the bar does
  const barShown = bar && !keyboardUp;
  useEffect(() => {
    if (!barShown) return;
    const root = document.documentElement;
    root.style.setProperty(
      "--control-bar-h",
      `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom))`
    );
    root.style.setProperty("--pane-inset-bottom", "0px");
    return () => {
      root.style.removeProperty("--control-bar-h");
      root.style.removeProperty("--pane-inset-bottom");
    };
  }, [barShown]);

  if (bar && keyboardUp) return null;

  const hint = bar ? "top" : "left";
  // Focus keeps the column quiet: only the dot on its own toggle remains
  const groups: Omit<ColumnItemProps, "hint">[][] = [
    [
      {
        icon: Plus,
        label: "New",
        shortcut: `${mod}N`,
        ariaLabel: "New session",
        selected: newOpen,
        onClick: () => runNav("new"),
      },
      {
        icon: Inbox,
        label: "Needs you",
        shortcut: `${mod}I`,
        selected: inboxOpen,
        badge: focus ? 0 : needsYou,
        // Waiting sessions and blocked background agents (useNeedsYou)
        ariaLabel: needsYou
          ? `Needs you, ${needsYou} waiting`
          : "Needs you, nothing waiting",
        onClick: () => runNav("inbox"),
      },
    ],
    [
      {
        icon: MessageSquare,
        label: "Chat",
        shortcut: `${mod}1`,
        selected: viewMode === "chat",
        onClick: () => runNav("chat"),
      },
      {
        icon: SquareTerminal,
        label: "Terminal",
        shortcut: `${mod}2`,
        selected: viewMode === "terminal",
        onClick: () => runNav("terminal"),
      },
      {
        icon: GitBranch,
        label: "Changes",
        shortcut: `${mod}3`,
        selected: viewMode === "git",
        badge: focus ? 0 : changes,
        badgeTone: "neutral",
        onClick: () => runNav("git"),
      },
      {
        icon: FolderOpen,
        label: "Files",
        shortcut: `${mod}4`,
        selected: viewMode === "files",
        onClick: () => runNav("files"),
      },
    ],
    [
      {
        icon: Search,
        label: "Find",
        shortcut: `${mod}K`,
        onClick: () => runNav("find"),
      },
      {
        icon: Focus,
        label: "Focus",
        shortcut: `${mod}.`,
        selected: focus,
        toggle: true,
        dot: focus && needsYou > 0,
        ariaLabel:
          focus && needsYou > 0 ? "Focus, on; something needs you" : "Focus",
        onClick: () => runNav("focus"),
      },
      ...(bar
        ? []
        : [
            {
              icon: Settings,
              label: "Settings",
              shortcut: `${mod},`,
              selected: settingsOpen,
              onClick: () => runNav("settings"),
            },
          ]),
    ],
  ];

  // Glass-like: translucent over what scrolls behind, a hairline and a highlight
  const glass =
    "bg-background/70 border-border backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08)]";

  if (bar) {
    return (
      <nav
        aria-label="Main"
        className={cn(
          glass,
          "flex shrink-0 items-center justify-around border-t pt-1 pr-[calc(0.25rem+env(safe-area-inset-right))] pb-[calc(0.25rem+env(safe-area-inset-bottom))] pl-[calc(0.25rem+env(safe-area-inset-left))]",
          className
        )}
        style={{
          minHeight: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
        }}
      >
        {groups.flat().map((item) => (
          <ColumnItem
            key={item.label}
            {...item}
            hint={hint}
            className="w-auto max-w-12 min-w-0 flex-1 rounded-2xl"
          />
        ))}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Main"
      className={cn(
        glass,
        "flex shrink-0 flex-col items-center gap-0.5 rounded-[28px] border p-1",
        // Scrolling would clip the hover hints, so only the Duo's needs it
        sideRail && "fixed z-40 overflow-y-auto",
        className
      )}
      style={{
        width: COLUMN_WIDTH,
        ...(sideRail && {
          top: SIDE_RAIL_TOP,
          right: Math.max(0, (sideRailWidth - COLUMN_WIDTH) / 2),
          maxHeight,
        }),
      }}
    >
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="bg-border my-1 h-px w-6" />}
          {group.map((item) => (
            <ColumnItem key={item.label} {...item} hint={hint} />
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
