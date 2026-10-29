"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { FoldSplit } from "@/components/FoldSplit";
import { InboxItem } from "@/components/Inbox";
import { UsagePill, type UsagePillVariant } from "@/components/UsagePill";
import { BackgroundAgents } from "@/components/BackgroundAgents";
import { useLayoutMode, type LayoutMode } from "@/hooks/useLayoutMode";
import { displayTitle } from "@/hooks/useSessionTitles";
import { useSnapshot } from "valtio";
import { openNew } from "@/stores/newSurface";
import { mobileNavStore } from "@/stores/mobileNav";
import type { SessionStatus } from "@/components/views/types";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { nowSubline } from "./now-summary";
import {
  DoneTodaySection,
  LimitedSection,
  NeedsSection,
  QuietSection,
  WorkingSection,
} from "./NowSections";
import { useNowItems } from "./useNowItems";

/** The mocks' page padding per posture (Main, E-iPhone, Open-Now) */
const PAD: Record<LayoutMode, string> = {
  phone: "px-4 pt-[15px]",
  "duo-closed": "pt-[18px] pr-2 pl-5",
  tabletop: "px-4 pt-4",
  "duo-open": "pt-5 pr-5 pl-6",
  book: "pt-5 pr-5 pl-6",
  desktop: "pt-5 pr-5 pl-6",
};

const PILL: Record<LayoutMode, UsagePillVariant> = {
  phone: "phone",
  "duo-closed": "closed",
  tabletop: "closed",
  "duo-open": "wide",
  book: "wide",
  desktop: "wide",
};

/** The page beside a session: rows, not cards (Open-Now) */
const isWide = (mode: LayoutMode) =>
  mode === "duo-open" || mode === "book" || mode === "desktop";

interface MissionControlProps {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  projectNames: Record<string, string>;
  activeSessionId?: string;
  /** The open session, highlighted where it's listed */
  selectedId?: string;
  onOpenSession: (session: Session) => void;
  /** Back to the session underneath, where nothing else leads there */
  onClose?: () => void;
  /** Projects, the column's item: the session list until M1b's page */
  projectsView?: ReactNode;
}

/**
 * The app's home: what needs you, answerable in place, what's working,
 * what's done today, then the quiet projects. New, Projects and Settings
 * are in the column (or the tab bar).
 */
export function MissionControl({
  sessions,
  sessionStatuses,
  projectNames,
  activeSessionId,
  selectedId = activeSessionId,
  onOpenSession,
  onClose,
  projectsView,
}: MissionControlProps) {
  const mode = useLayoutMode();
  const { homeTab } = useSnapshot(mobileNavStore);
  const wide = isWide(mode);
  const now = useNowItems(sessions, sessionStatuses);
  const first = now.waiting[0];
  // The needs count is useNeedsYou's, as on the column badge
  const subline = nowSubline({
    needs: now.needsCount,
    working: now.workingCount,
    limited: now.limited.length,
    settledToday: now.settled.length,
  });

  const sectionProps = {
    now,
    wide,
    projectNames,
    sessionStatuses,
    selectedId,
    onOpenSession,
  };

  // On a table the list stays above the fold and the base answers the
  // first prompt, the same card as above it, or starts something when
  // nothing waits
  const ref = useRef<HTMLDivElement>(null);
  const list = (cardOnBase: boolean) => (
    // --home-pad-b: on a phone the list scrolls on under the tab bar
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto pb-[calc(1.5rem+var(--home-pad-b,0px))]",
        PAD[mode]
      )}
    >
      <div className="flex flex-col gap-3.5">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to the session"
            className="text-muted-foreground active:bg-accent -mb-2 -ml-2 flex h-11 w-11 items-center justify-center rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="t-large">Now</h1>
            <p className="text-muted-foreground mt-1 truncate text-[15px]">
              {subline}
            </p>
          </div>
          <UsagePill variant={PILL[mode]} />
        </header>

        <NeedsSection {...sectionProps} skipFirst={cardOnBase} />
        <LimitedSection {...sectionProps} />
        <WorkingSection {...sectionProps} />
        {now.needsCount === 0 &&
          now.workingCount === 0 &&
          now.limited.length === 0 && (
            <div className="px-1 py-2">
              <p className="font-medium">Nothing running</p>
              <p className="text-muted-foreground text-sm">
                {now.quiet.length + now.loose.length
                  ? "Start a session, or pick up one below."
                  : "Start a session."}
              </p>
            </div>
          )}
        <DoneTodaySection {...sectionProps} sessions={sessions} />
        <QuietSection {...sectionProps} />

        {/* Agents outside every project, once they've stopped working:
            listed nowhere else, so open and remove them from here */}
        {now.elsewhere.length > 0 && (
          <BackgroundAgents agents={now.elsewhere} title="Other agents" />
        )}
      </div>
    </div>
  );

  // Projects draws its own title, padding and (in the iOS app before it
  // takes the column) its way back
  if (homeTab === "projects" && projectsView)
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col",
          wide ? "bg-page" : "bg-background"
        )}
      >
        {projectsView}
      </div>
    );

  return (
    <div
      ref={ref}
      className={cn(
        "flex h-full min-h-0 flex-col",
        wide ? "bg-page" : "bg-background"
      )}
    >
      <FoldSplit
        el={ref}
        className="flex-1"
        top={list(true)}
        base={
          <TableBase>
            {first && (
              <InboxItem
                as="div"
                variant="card"
                session={first}
                projectName={
                  first.project_id ? projectNames[first.project_id] : undefined
                }
                title={displayTitle(first, now.titles).title}
                onOpen={() => onOpenSession(first)}
              />
            )}
          </TableBase>
        }
      >
        {list(false)}
      </FoldSplit>
    </div>
  );
}

/** The home's base on a table: what it's given, else New and the usage */
function TableBase({ children }: { children?: ReactNode }) {
  return (
    // Pushed down to the thumbs, but scrolls from its top if it's taller
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mt-auto flex flex-col gap-3">
        {children || (
          <>
            <div className="flex justify-center">
              <UsagePill />
            </div>
            <button
              type="button"
              onClick={() => openNew()}
              className="pill pill-primary w-full shrink-0 active:opacity-80"
            >
              <Plus className="h-4 w-4" />
              New session
            </button>
          </>
        )}
      </div>
    </div>
  );
}
