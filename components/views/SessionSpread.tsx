"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import dynamic from "next/dynamic";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import type { ProjectWithRepositories } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { ActivityRail } from "@/components/Session/ActivityRail";
import { ControlColumn } from "@/components/ControlColumn";
import { LiveSheet } from "@/components/ControlColumn/LiveSheet";
import { usePanes } from "@/contexts/PaneContext";
import { GitPanelSkeleton } from "@/components/Pane/PaneSkeletons";
import { useIsNative } from "@/hooks/useIsNative";
import { FOLD_CLEAR, useHinge } from "@/hooks/useHinge";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { navStore, registerNavHandlers, runNav } from "@/lib/nav-actions";
import { dropHome, notePageUsed, setHome } from "@/stores/surface";
import { isNative, nativeCaps } from "@/lib/native-bridge";
import { postureStore } from "@/stores/posture";
import { resetSwap, toggleSwap } from "@/stores/paneOrder";
import { focusStore } from "@/stores/focus";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { ContextPanel } from "@/components/ReplyContext/ContextPanel";
import { ChangesPage } from "@/components/Changes/ChangesPage";
import { DiffReview } from "@/components/DiffViewer/DiffReview";
import {
  closeDiffReview,
  diffReviewStore,
  undoReviewTurn,
} from "@/stores/diffReview";
import { spreadLayout } from "./spread-layout";
import { useReplyContext } from "@/hooks/useReplyContext";
import {
  setContextShownElsewhere,
  setReplyPage,
  useReplying,
} from "@/components/ReplyContext/store";
import { PagePanel } from "@/components/ui/page-panel";
import { PageEdge } from "@/components/ui/page-edge";

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

/** Where the fold crosses a pane laid across both pages, in viewport px */
export interface SpreadFold {
  start: number;
  end: number;
}

const SpreadContext = createContext<SpreadFold | null>(null);

/**
 * How the panes lay out on the open Duo's pages: two side by side, one each
 * side of the fold ("fold", the left page's width and the gap), or only the
 * focused one ("single", the home on the left page); null lays them out as
 * the web does
 */
export type SpreadPanes =
  | { mode: "fold"; left: string; gutter: number }
  | { mode: "single" }
  | null;

const SpreadPanesContext = createContext<SpreadPanes>(null);

export function useSpreadPanes(): SpreadPanes {
  return useContext(SpreadPanesContext);
}

/**
 * Open-Beside's session pills name the two pages, and the column holds
 * their actions, so the panes drop their title bars. The iOS app before
 * the column (0.1.62) keeps the bars: swap lives there
 */
export function besidePills(): boolean {
  return !isNative() || nativeCaps().column;
}

/**
 * The fold, while the pane spans both pages of the open Duo (Focus), so the
 * chat can read as a book; null otherwise
 */
export function useSpreadFold(): SpreadFold | null {
  return useContext(SpreadContext);
}

/** Narrower pages than this and an element stays one column */
const PAGE_MIN = 280;

/** An element split into two pages at the fold, in px from its left edge */
export interface SpreadPages {
  /** The left page's width */
  left: number;
  /** Empty between the pages (only the hinge's clearance while flat) */
  gutter: number;
  /** The right page's width */
  right: number;
}

/**
 * How `ref`'s element splits into two pages at the fold, from its left edge
 * to its right padding (a system column's inset); null if there's no fold or
 * a page would be too narrow. Flat there's no gutter, but controls on either
 * page still keep clear of the hinge.
 */
export function useSpreadPages(
  ref: RefObject<HTMLElement | null>,
  fold: SpreadFold | null
): SpreadPages | null {
  const [pages, setPages] = useState<SpreadPages | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fold) {
      setPages(null);
      return;
    }
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const start = rect.left;
      const end =
        rect.right - (parseFloat(getComputedStyle(el).paddingRight) || 0);
      const clear = fold.end > fold.start ? 0 : FOLD_CLEAR;
      // Whole pixels, rounded towards the pages so none lands in the gutter
      const left = Math.floor(fold.start - clear - start);
      const gutter = Math.ceil(fold.end + clear - start) - left;
      const right = Math.floor(end - fold.end - clear);
      const fits = left >= PAGE_MIN && right >= PAGE_MIN;
      setPages((prev) =>
        !fits
          ? null
          : prev?.left === left &&
              prev.gutter === gutter &&
              prev.right === right
            ? prev
            : { left, gutter, right }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, fold]);
  return pages;
}

interface SessionSpreadProps {
  /** The focused pane's session, for the rail and the book pose's Changes */
  session: Session | undefined;
  projects: { id: string }[];
  /** The home (Now); shown while homeOpen */
  home: ReactNode;
  homeOpen: boolean;
  /**
   * The desktop's home width (its sidebar or avatar rail): flat against the
   * panes, no shadow; the web's default sidebar width otherwise
   */
  homeWidth?: number;
  /** A workspace page standing in for the panes and the rail, or null */
  page?: ReactNode;
  /**
   * The page lays out its own list | detail around the fold (Needs you), so
   * on the open Duo it takes both pages and the home makes way
   */
  pageSpread?: boolean;
  /** The panes */
  children: ReactNode;
}

/**
 * The session and what sits around it. Web: home | pane | live activity |
 * control column; the desktop has its sidebar (or avatar rail) for the home
 * and no column. The open iPhone Duo lays it out as two pages: pane left and
 * rail right, or the home left (back) and the pane right. Focus (and the
 * views other than terminal and chat) drop the home and rail; the pane then
 * spans the fold flat (only controls avoid it, see .fold-controls). Half open
 * the chat reads as a book, the terminal takes the right page with Changes on
 * the left, and anything else takes the right page. The column's Changes
 * puts Changes on the right page beside the conversation, in the rail's
 * place (Open-Changes). spread-layout.ts decides what goes where.
 *
 * Typing a reply in the one session open, Claude's last turn takes the left
 * page and holds still while the pane, with its composer, takes the right.
 *
 * A workspace page takes the pane's place (on the right page, or both pages
 * for one with its own list | detail) and the panes wait under it, hidden.
 *
 * Every slot keeps its place whether shown or not, so the panes never
 * remount (a terminal must not attach twice).
 */
export function SessionSpread({
  session,
  projects,
  home,
  homeOpen: homeWanted,
  homeWidth,
  page,
  pageSpread,
  children,
}: SessionSpreadProps) {
  const native = useIsNative();
  const mode = useLayoutMode();
  // The Duo lays out as two pages in the app and in Safari alike
  const duo = native || mode === "duo-open" || mode === "book";
  // The desktop shell (sidebar, no column) never reaches the open Duo
  const desktop = mode === "desktop" && !native;
  const { fold } = useSnapshot(postureStore);
  const book = fold?.axis === "vertical" ? fold : null;
  const hingeX = useHinge(duo && !fold);
  const { on: focus } = useSnapshot(focusStore);
  const { viewMode, liveOpen, changesOpen } = useSnapshot(mobileNavStore);
  const { open: review } = useSnapshot(diffReviewStore);
  const reviewOpen = !!review && review.sessionId === session?.id;
  const roomForRail = useMinWidth(RAIL_MIN_VIEWPORT);

  // Two pages either side of the fold: the left one's width, then the gap
  const pages = duo && (book || hingeX !== null);
  const leftPage = book
    ? `calc(${book.start}px - env(safe-area-inset-left))`
    : `calc(var(--hinge-x) - ${FOLD_CLEAR}px - env(safe-area-inset-left))`;
  const gutter = book ? book.end - book.start : FOLD_CLEAR * 2;

  const folder = session?.working_directory;
  const pageOpen = !!page;
  const { paneCount, swap } = usePanes();
  // Replying to the one session open: its context on the left page, the
  // pane on the right (two open keep their own cards above each composer)
  // (only with something to show: a shell session has no Claude turn)
  const typing = useReplying(session?.id);
  const replyContext = useReplyContext(session?.id, !!pages && typing);
  // An iOS app without the column has no Live to ask with, so there the
  // rail stays as before
  const railByDefault = native && !nativeCaps().column;
  const {
    pageWide,
    twoPages,
    replyLeft,
    homeOpen,
    homeFill,
    splitFold,
    changesLeft,
    changesRoom,
    changesReach,
    changesBeside,
    reviewRoom,
    reviewBeside,
    showRail,
    paneLeft,
    paneRight,
    paneWide,
    pageGap,
  } = spreadLayout({
    duo,
    desktop,
    pages: !!pages,
    book: !!book,
    focus,
    homeWanted,
    pageOpen,
    pageSpread: !!pageSpread,
    paneCount,
    hasSession: !!session,
    hasFolder: !!folder,
    replying: typing && !!replyContext,
    viewMode,
    liveOpen,
    railByDefault,
    changesOpen,
    roomForRail,
    reviewOpen,
  });
  // Flat there's no gutter: the pages meet at the hinge
  const spreadStart = book ? book.start : hingeX;
  const spreadEnd = book ? book.end : hingeX;
  const spreadFold = useMemo<SpreadFold | null>(
    () =>
      paneWide && spreadStart !== null && spreadEnd !== null
        ? { start: spreadStart, end: spreadEnd }
        : null,
    [paneWide, spreadStart, spreadEnd]
  );

  // The left page shows the context, so the card above the box steps aside
  const replyId = replyLeft ? session?.id : undefined;
  useEffect(() => {
    if (!replyId) return;
    setContextShownElsewhere(replyId, true);
    setReplyPage(replyId, true);
    return () => {
      setContextShownElsewhere(replyId, false);
      setReplyPage(replyId, false);
    };
  }, [replyId]);

  // Where the review has room, the chat hands it here (stores/diffReview)
  const roomFor = reviewRoom ? (session?.id ?? null) : null;
  useEffect(() => {
    diffReviewStore.room = roomFor;
    return () => {
      if (diffReviewStore.room === roomFor) diffReviewStore.room = null;
    };
  }, [roomFor]);

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

  // The home beside the panes, for the surface (Now)
  useEffect(() => setHome(homeWanted), [homeWanted]);
  useEffect(() => dropHome, []);

  // Which page was used last, for a fold to one page: a tap on either, or
  // a view picked for the session
  const homeRef = useRef<HTMLDivElement>(null);
  const notePage = (e: PointerEvent) => {
    if (pages && homeOpen && !homeFill)
      notePageUsed(
        homeRef.current?.contains(e.target as Node) ? "home" : "session"
      );
  };
  const shownMode = useRef(viewMode);
  useEffect(() => {
    if (shownMode.current === viewMode) return;
    shownMode.current = viewMode;
    notePageUsed("session");
  }, [viewMode]);

  // Two on the pages trade sides in place (CSS order, nothing remounts);
  // elsewhere the split itself swaps
  useEffect(
    () => registerNavHandlers({ swapPanes: twoPages ? toggleSwap : swap }),
    [twoPages, swap]
  );
  // Open-Changes: the column's Changes opens Changes on the right page,
  // beside the conversation, where Live would go (they share the page)
  const changesHere = changesRoom && !replyLeft;
  useEffect(() => {
    if (!changesHere) return;
    return registerNavHandlers({
      openLive: () => {
        mobileNavStore.changesOpen = false;
        mobileNavStore.liveOpen = true;
      },
    });
  }, [changesHere]);
  // The same Changes from Now, Files or the git view: Now steps aside and
  // the conversation comes back beside it. The iOS app before the column
  // (0.1.62) sends `git` from its toolbar: that keeps opening the git view,
  // as it always did
  const changesFromColumn =
    changesReach && !replyLeft && (!native || nativeCaps().column);
  useEffect(() => {
    if (!changesFromColumn) return;
    return registerNavHandlers({
      openChanges: () => {
        if (homeWanted) navStore.resume();
        const view = mobileNavStore.viewMode;
        if (view !== "chat" && view !== "terminal")
          mobileNavActions.requestViewMode(mobileNavStore.conversationView);
        mobileNavStore.changesOpen = true;
        mobileNavStore.liveOpen = false;
      },
    });
  }, [changesFromColumn, homeWanted]);
  // The right page's ×, handle and ‹: whichever panel is there closes
  const closePanel = useCallback(() => {
    mobileNavStore.changesOpen = false;
    mobileNavStore.liveOpen = false;
  }, []);
  // It closes once the pages go away or something else takes them
  useEffect(() => {
    if (!changesRoom) mobileNavStore.changesOpen = false;
  }, [changesRoom]);
  // Live opened another way (the session's status card) takes the page too
  useEffect(() => {
    if (liveOpen) mobileNavStore.changesOpen = false;
  }, [liveOpen]);
  // A different session starts without it
  const sessionId = session?.id;
  useEffect(
    () => () => {
      mobileNavStore.changesOpen = false;
    },
    [sessionId]
  );

  // A new pair starts in order. Only on the way down from two: the saved
  // layout loads after the first render, and its pair keeps its sides
  const lastPaneCount = useRef(paneCount);
  useEffect(() => {
    if (paneCount < 2 && lastPaneCount.current >= 2) resetSwap();
    lastPaneCount.current = paneCount;
  }, [paneCount]);

  const spreadPanes = useMemo<SpreadPanes>(
    () =>
      splitFold
        ? { mode: "fold", left: leftPage, gutter }
        : twoPages
          ? { mode: "single" }
          : null,
    [splitFold, twoPages, leftPage, gutter]
  );

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
      : homeWidth
        ? { width: homeWidth }
        : undefined;

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1"
      onPointerDownCapture={notePage}
    >
      {/* The home: a sidebar on the web, the left page on the open Duo */}
      <div
        ref={homeRef}
        className={cn(
          "kb-compact-hide bg-sidebar-background relative flex-shrink-0 overflow-hidden transition-all duration-200",
          !homeWidth && "shadow-xl shadow-black/10 dark:shadow-black/30",
          homeOpen && !pages && !homeWidth && (duo ? "w-1/2" : "w-[22rem]"),
          homeOpen && duo && !book && "border-border border-r"
        )}
        style={homeStyle}
      >
        {/* On the pages Now sits beside the session: its fold-side grip
            puts it away and the session takes both pages */}
        {homeOpen && !homeFill && pages && session && (
          <PageEdge
            side="right"
            label="Back to session"
            onClose={() => runNav("resume")}
          />
        )}
        {/* The page's own colour edge to edge (Open-Now); the bottom inset
            keeps the last row clear of the open Duo's round screen corner */}
        <div
          className={cn(
            "bg-page h-full",
            !homeWidth && "pb-[max(1rem,env(safe-area-inset-bottom))]"
          )}
        >
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
            sessionId={session?.id}
            workingDirectory={folder}
            projectId={session?.project_id ?? undefined}
            repositories={repositories}
          />
        </div>
      )}

      {/* Replying: Claude's last turn on the left page, still while the
          right one moves with the keyboard */}
      {replyLeft && session && (
        <ContextPanel
          sessionId={session.id}
          view={viewMode === "terminal" ? "terminal" : "chat"}
          edges
          className="flex-shrink-0"
          style={{ width: leftPage }}
        />
      )}

      {paneRight && !replyLeft && (
        <div
          aria-hidden="true"
          className="bg-background kb-compact-hide flex-shrink-0"
          style={{ width: leftPage }}
        />
      )}

      {/* Nothing in the fold */}
      {pageGap && (
        <div
          aria-hidden="true"
          className={cn(
            "bg-background flex-shrink-0",
            // Its left page stays while typing, so the fold does too
            !replyLeft && "kb-compact-hide"
          )}
          style={{ width: gutter }}
        />
      )}

      <div
        // A spread page keeps its controls on its own pages
        data-spread={paneWide && !pageWide ? "wide" : undefined}
        className={cn("flex min-w-0", paneLeft ? "flex-shrink-0" : "flex-1")}
        style={paneLeft ? { width: leftPage } : undefined}
      >
        <div
          className="mx-auto h-full w-full"
          style={focus && !duo ? { maxWidth: FOCUS_MAX_WIDTH } : undefined}
        >
          {/* Hidden rather than unmounted: the terminal refits when shown */}
          <div className={cn("h-full w-full", pageOpen && "hidden")}>
            <SpreadContext.Provider value={spreadFold}>
              <SpreadPanesContext.Provider value={spreadPanes}>
                {children}
              </SpreadPanesContext.Provider>
            </SpreadContext.Provider>
          </div>
          <SpreadContext.Provider value={spreadFold}>
            {page}
          </SpreadContext.Provider>
        </div>
      </div>

      {paneLeft && (
        <div
          aria-hidden="true"
          className="bg-background flex-shrink-0"
          style={{ width: gutter }}
        />
      )}

      {/* Changes: beside the conversation, in the rail's place */}
      {changesBeside && session && folder && (
        <PagePanel
          label="Changes"
          onClose={closePanel}
          className="bg-page min-w-0 flex-1"
        >
          <ChangesPage
            sessionId={session.id}
            workingDirectory={folder}
            onClose={closePanel}
            className="bg-page min-w-0 flex-1 pl-6"
          />
        </PagePanel>
      )}

      {/* A turn's diff review: the right page (O-Diff), or beside the chat
          on the desktop (D-Diff), the session header over the chat only */}
      {reviewBeside && session && review && (
        <DiffReview
          key={`${session.id}:${review.turnNo}`}
          session={session}
          agentName="Claude"
          initialScope={`turn:${review.turnNo}`}
          placement="page"
          onClose={closeDiffReview}
          onUndoTurn={undoReviewTurn}
          className={
            pages
              ? "bg-background min-w-0 flex-1"
              : "bg-background border-border w-[min(60rem,60%)] flex-shrink-0 border-l"
          }
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
          {pages ? (
            <PagePanel
              label="Live activity"
              onClose={closePanel}
              className="flex-1"
            >
              <ActivityRail
                session={session}
                onClose={closePanel}
                className="flex-1 pl-6"
              />
            </PagePanel>
          ) : (
            <ActivityRail session={session} className="flex-1" />
          )}
        </aside>
      )}

      {/* The one view switcher; the iOS app has its own. On the open Duo
          it sits in the system column's 86px, below the camera (Open-Now:
          20 + 16 + 24 + 40) */}
      {!native && !desktop && (
        <div
          className={cn(
            "flex flex-shrink-0 justify-center",
            duo ? "w-[86px] pt-[100px]" : "w-16 py-2"
          )}
        >
          <ControlColumn variant="column" className="self-start" />
        </div>
      )}

      {/* Live activity where the rail isn't showing */}
      <LiveSheet session={session} />
    </div>
  );
}
