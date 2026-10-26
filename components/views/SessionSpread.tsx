"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import type { ProjectWithRepositories } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { ActivityRail } from "@/components/Session/ActivityRail";
import { ControlColumn } from "@/components/ControlColumn";
import { GitPanelSkeleton } from "@/components/Pane/PaneSkeletons";
import { useIsNative } from "@/hooks/useIsNative";
import { FOLD_CLEAR, useHinge } from "@/hooks/useHinge";
import { postureStore } from "@/stores/posture";
import { focusStore } from "@/stores/focus";
import { mobileNavStore } from "@/stores/mobileNav";

const GitPanel = dynamic(
  () => import("@/components/GitPanel").then((mod) => mod.GitPanel),
  { ssr: false, loading: () => <GitPanelSkeleton /> }
);

/** Narrower than this, the web leaves the live activity rail out */
const RAIL_MIN_VIEWPORT = 1100;
/** Focus on the web: the pane at reading width */
const FOCUS_MAX_WIDTH = 820;

function useMinWidth(px: number): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return matches;
}

interface SessionSpreadProps {
  /** The focused pane's session, for the rail and the book pose's Changes */
  session: Session | undefined;
  projects: { id: string }[];
  /** The home (Now); shown while homeOpen */
  home: ReactNode;
  homeOpen: boolean;
  /** The panes */
  children: ReactNode;
}

/**
 * The session and what sits around it. Web: home | pane | live activity |
 * control column. The open iPhone Duo lays it out as two pages: pane left and
 * rail right, or the home left (back) and the pane right. Focus drops the
 * home and rail; the pane then spans the fold (flat: only controls avoid it,
 * see .fold-controls), and half open the terminal takes the right page with
 * Changes on the left.
 *
 * Every slot keeps its place whether shown or not, so the panes never
 * remount (a terminal must not attach twice).
 */
export function SessionSpread({
  session,
  projects,
  home,
  homeOpen,
  children,
}: SessionSpreadProps) {
  const native = useIsNative();
  const { fold } = useSnapshot(postureStore);
  const book = fold?.axis === "vertical" ? fold : null;
  const hingeX = useHinge(native && !fold);
  const { on: focus } = useSnapshot(focusStore);
  const { viewMode } = useSnapshot(mobileNavStore);
  const roomForRail = useMinWidth(RAIL_MIN_VIEWPORT);

  // Two pages either side of the fold: the left one's width, then the gap
  const pages = native && (book || hingeX !== null);
  const leftPage = book
    ? `calc(${book.start}px - env(safe-area-inset-left))`
    : `calc(var(--hinge-x) - ${FOLD_CLEAR}px - env(safe-area-inset-left))`;
  const gutter = book ? book.end - book.start : FOLD_CLEAR * 2;

  const folder = session?.working_directory;
  const changesLeft =
    !!book && focus && !homeOpen && viewMode === "terminal" && !!folder;
  const showRail =
    !!session && !focus && (pages ? !homeOpen : roomForRail && !native);
  // Pane on the left page, the rail on the right (the home and Changes left
  // pages only come with no rail)
  const paneLeft = pages && showRail;
  // Across the fold: content may cross it, controls move right of it
  const paneWide = pages && !homeOpen && !changesLeft && !showRail;
  const pageGap = pages && (homeOpen || changesLeft);

  useEffect(() => {
    mobileNavStore.railShown = showRail;
    return () => {
      mobileNavStore.railShown = false;
    };
  }, [showRail]);

  // The column (web) or the iOS app's own bar switches views here
  useEffect(() => {
    mobileNavStore.railActive = true;
  }, []);

  const repositories =
    (
      projects.find((p) => p.id === session?.project_id) as
        | Partial<ProjectWithRepositories>
        | undefined
    )?.repositories ?? [];

  const homeStyle: CSSProperties | undefined = !homeOpen
    ? { width: 0 }
    : pages
      ? { width: leftPage }
      : undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* The home: a sidebar on the web, the left page on the open Duo */}
      <div
        className={cn(
          "kb-compact-hide bg-sidebar-background flex-shrink-0 overflow-hidden shadow-xl shadow-black/10 transition-all duration-200 dark:shadow-black/30",
          homeOpen && !pages && (native ? "w-1/2" : "w-[22rem]"),
          homeOpen && native && !book && "border-border border-r"
        )}
        style={homeStyle}
      >
        {/* Its rows are inset px-4 already: px-1 more makes the 20px that,
            with the bottom inset, keeps the last row clear of the open
            Duo's round screen corner */}
        <div className="bg-background h-full px-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {home}
        </div>
      </div>

      {/* Half open, Focus on the terminal: Changes reads on the left page */}
      {changesLeft && folder && (
        <div
          className="kb-compact-hide flex-shrink-0 overflow-hidden"
          style={{ width: leftPage }}
        >
          <GitPanel
            workingDirectory={folder}
            projectId={session?.project_id ?? undefined}
            repositories={repositories}
          />
        </div>
      )}

      {/* Nothing in the fold */}
      {pageGap && (
        <div
          aria-hidden="true"
          className="bg-background kb-compact-hide flex-shrink-0"
          style={{ width: gutter }}
        />
      )}

      <div
        data-spread={paneWide ? "wide" : undefined}
        className={cn("flex min-w-0", paneLeft ? "flex-shrink-0" : "flex-1")}
        style={paneLeft ? { width: leftPage } : undefined}
      >
        <div
          className="mx-auto h-full w-full"
          style={focus && !native ? { maxWidth: FOCUS_MAX_WIDTH } : undefined}
        >
          {children}
        </div>
      </div>

      {paneLeft && (
        <div
          aria-hidden="true"
          className="bg-background flex-shrink-0"
          style={{ width: gutter }}
        />
      )}

      {/* Live activity: solid, beside the pane */}
      {showRail && session && (
        <aside
          aria-label="Live activity"
          className={cn(
            "bg-background flex min-h-0 flex-col",
            pages
              ? "min-w-0 flex-1"
              : "border-border w-[300px] flex-shrink-0 border-l min-[1280px]:w-[320px]"
          )}
        >
          <ActivityRail session={session} className="flex-1" />
        </aside>
      )}

      {/* The one view switcher; the iOS app has its own */}
      {!native && (
        <div className="flex w-16 flex-shrink-0 justify-center py-2">
          <ControlColumn variant="column" className="self-start" />
        </div>
      )}
    </div>
  );
}
