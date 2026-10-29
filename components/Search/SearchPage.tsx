"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSnapshot } from "valtio";
import {
  FileDiff,
  FileText,
  Play,
  Search,
  SquareSlash,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearch } from "@/data/search";
import { MIN_QUERY, SEARCH_LIMITS } from "@/lib/search/types";
import type {
  SearchCommand,
  SearchFileHit,
  SearchMessageHit,
  SearchSessionHit,
} from "@/lib/search/types";
import { sessionState, shortAge } from "@/lib/agent-state";
import { isNative, nativeCaps } from "@/lib/native-bridge";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { mobileNavStore } from "@/stores/mobileNav";
import { postureStore } from "@/stores/posture";
import { StateDot } from "@/components/a/StateDot";
import { agentName } from "@/components/a/Avatar";
import { Highlight } from "./Highlight";
import { useOpenSearchResult } from "./useOpenSearchResult";
import {
  effectiveFilter,
  messageMeta,
  pageChips,
  recentSessionHits,
  resultCount,
  resultCountText,
  visibleSections,
  type PageFilter,
  type PageSection,
} from "./search-page-model";
import type { SearchResult, SearchSurfaceProps } from "./types";

/**
 * Phone and Duo full page (N-Search): pill input with count and clear,
 * chips All / Sessions / Messages / Files with counts, session cards,
 * message rows, file rows with hits, commands with Run. Clear of the
 * closed Duo's column. Owned by U11.4
 */
export function SearchPage(props: SearchSurfaceProps) {
  if (!props.open) return null;
  return <SearchLayer {...props} />;
}

const SECTION_TITLE: Record<PageSection, string> = {
  sessions: "Sessions",
  messages: "Messages",
  files: "Files",
  commands: "Commands",
};

function SearchLayer(props: SearchSurfaceProps) {
  const { sessions, onOpenChange, currentSessionId } = props;
  const mode = useLayoutMode();
  const { railWidth, statuses } = useSnapshot(mobileNavStore);
  const { fold } = useSnapshot(postureStore);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PageFilter>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const open = useOpenSearchResult(props);

  const projectId =
    sessions.find((s) => s.id === currentSessionId)?.project_id ?? undefined;
  const q = query.trim();
  const searching = q.length >= MIN_QUERY;
  const search = useSearch(
    { q, kind: "all", projectId, sessionId: currentSessionId },
    true
  );
  const res = searching ? search.data : undefined;
  const shownFilter = effectiveFilter(filter, res);
  const sections = visibleSections(res, shownFilter);
  const count = resultCount(res);

  const recent = useMemo(
    () =>
      searching ? [] : recentSessionHits(sessions, SEARCH_LIMITS.sessions),
    [searching, sessions]
  );

  // The column draws back (the closed Duo's, the app's own once it takes
  // the column spec); otherwise the page has its own Cancel
  const native = isNative();
  const columnNav =
    (native && nativeCaps().column) ||
    (!native && (railWidth > 0 || mode === "duo-closed"));

  // The open Duo: the right page, clear of the web column in the spread
  const [columnRight, setColumnRight] = useState(0);
  useEffect(() => {
    if (mode !== "duo-open") return;
    const column = document.querySelector("[data-control-column]");
    setColumnRight(
      column
        ? Math.max(0, window.innerWidth - column.getBoundingClientRect().left)
        : 0
    );
  }, [mode]);

  // Typing at once: in the same tap that opened it, so iOS shows the keyboard
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Esc closes (capture: the terminal would take it), unless a dialog on
  // top takes it first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if ([...dialogs].some((d) => d !== layerRef.current)) return;
      e.preventDefault();
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onOpenChange]);

  const status = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    return sessionState(session ?? {}, statuses[id]?.status);
  };

  const rows: Record<PageSection, SearchResult[]> = {
    sessions: (res?.sessions ?? []).map((hit) => ({ kind: "session", hit })),
    messages: (res?.messages ?? []).map((hit) => ({ kind: "message", hit })),
    files: (res?.files ?? []).map((hit) => ({ kind: "file", hit })),
    commands: (res?.commands ?? []).map((hit) => ({ kind: "command", hit })),
  };
  const first = sections.length ? rows[sections[0]][0] : undefined;

  const layerStyle: CSSProperties =
    mode === "duo-open"
      ? {
          left: "calc(var(--hinge-x, 50%) + var(--fold-clear, 0px))",
          right: columnRight,
        }
      : mode === "tabletop" && fold?.axis === "horizontal"
        ? // Half folded: the upper half, clear of the hinge; the keyboard
          // and the base's bar stay below it
          { left: 0, right: railWidth, bottom: "auto", height: fold.start }
        : { left: 0, right: railWidth };

  // Beside a column the gap to it is the column's own (8px); else 20px
  // and the notch's inset
  const padRight =
    railWidth > 0 || (mode === "duo-open" && columnRight > 0)
      ? "pr-2"
      : "pr-[calc(20px+env(safe-area-inset-right))]";

  let body: ReactNode;
  if (!searching) {
    body = recent.length ? (
      <Section title="Recent">
        <SessionCards hits={recent} status={status} onOpen={open} />
      </Section>
    ) : (
      <Empty>Search sessions, messages, files and commands</Empty>
    );
  } else if (search.isError && !res) {
    body = <Empty>Search isn&apos;t available right now</Empty>;
  } else if (!res) {
    body = null;
  } else if (!sections.length) {
    body = <Empty>No results for “{q}”</Empty>;
  } else {
    body = sections.map((section) => (
      <Section
        key={section}
        title={
          section === "commands" && res.sessionName
            ? `Commands · ${res.sessionName}`
            : SECTION_TITLE[section]
        }
        n={res[section].length}
      >
        {section === "sessions" && (
          <SessionCards hits={res.sessions} status={status} onOpen={open} />
        )}
        {section === "messages" && (
          <div className="group-card">
            {res.messages.map((hit) => (
              <MessageRow
                key={`${hit.sessionId}:${hit.itemId}`}
                hit={hit}
                onOpen={() => open({ kind: "message", hit })}
              />
            ))}
          </div>
        )}
        {section === "files" && (
          <div className="group-card">
            {res.files.map((hit) => (
              <FileRow
                key={`${hit.root}/${hit.path}`}
                hit={hit}
                onOpen={() => open({ kind: "file", hit })}
              />
            ))}
          </div>
        )}
        {section === "commands" && (
          <div className="group-card">
            {res.commands.map((hit) => (
              <CommandRow
                key={hit.id}
                hit={hit}
                onOpen={() => open({ kind: "command", hit })}
              />
            ))}
          </div>
        )}
      </Section>
    ));
  }

  return (
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      data-search-page
      className="bg-background fixed inset-y-0 z-[45] flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]"
      style={layerStyle}
    >
      <div className={cn("flex flex-none flex-col gap-1 pt-4 pl-5", padRight)}>
        <div className="flex items-center gap-2">
          <div className="glass flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[24px] pr-0.5 pl-3.5">
            <Search
              aria-hidden
              className="text-muted-foreground h-5 w-5 flex-none"
            />
            <input
              ref={inputRef}
              autoFocus
              type="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Search sessions, messages, files and commands"
              placeholder="Search everything"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && first) {
                  e.preventDefault();
                  open(first);
                }
              }}
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[16px] outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {res && (
              <span
                aria-live="polite"
                className="text-muted-foreground text-[13px] whitespace-nowrap"
              >
                {resultCountText(count)}
              </span>
            )}
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                className="text-foreground flex h-11 w-11 flex-none items-center justify-center rounded-full"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <span className="bg-foreground/15 flex h-[18px] w-[18px] items-center justify-center rounded-full">
                  <X className="h-3 w-3" strokeWidth={3} />
                </span>
              </button>
            ) : (
              <span className="w-3 flex-none" />
            )}
          </div>
          {!columnNav && (
            <button
              type="button"
              className="text-primary h-11 flex-none px-2 text-[16px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
          )}
        </div>

        {res && (
          <div
            role="group"
            aria-label="Filter results"
            className="-mt-1 flex gap-1.5 overflow-x-auto [scrollbar-width:none]"
          >
            {pageChips(res).map((chip) => {
              const on = chip.filter === shownFilter;
              return (
                <button
                  key={chip.filter}
                  type="button"
                  aria-pressed={on}
                  className="flex h-11 flex-none items-center"
                  onClick={() => setFilter(chip.filter)}
                >
                  <span
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] whitespace-nowrap",
                      on
                        ? "bg-primary font-semibold text-white"
                        : "bg-foreground/[0.08] text-foreground/80"
                    )}
                  >
                    {chip.label}
                    {chip.n !== undefined && (
                      <span
                        className={cn(
                          "text-[12px]",
                          on ? "text-white/80" : "text-muted-foreground"
                        )}
                      >
                        {chip.n}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pt-1.5 pb-[calc(1.5rem+max(env(safe-area-inset-bottom),var(--control-bar-h,0px)))] pl-5",
          padRight
        )}
      >
        <div className="flex flex-col gap-1.5">{body}</div>
      </div>
    </div>
  );
}

function Section({
  title,
  n,
  children,
}: {
  title: string;
  n?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-muted-foreground flex items-center gap-1.5 px-1 pt-1 text-[13px] font-semibold">
        <span className="truncate">{title}</span>
        {n !== undefined && <span className="font-medium">{n}</span>}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground px-1 py-10 text-center text-[15px]">
      {children}
    </p>
  );
}

function SessionCards({
  hits,
  status,
  onOpen,
}: {
  hits: SearchSessionHit[];
  status: (id: string) => ReturnType<typeof sessionState>;
  onOpen: (result: SearchResult) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {hits.map((hit) => (
        <button
          key={hit.id}
          type="button"
          className="bg-card flex min-h-14 min-w-0 flex-col justify-center gap-0.5 rounded-[20px] px-3 py-[9px] text-left"
          onClick={() => onOpen({ kind: "session", hit })}
        >
          <Highlight
            text={hit.name}
            ranges={hit.nameRanges}
            className="truncate text-[14px] font-semibold"
          />
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[13px]">
            <StateDot state={status(hit.id)} size={6} />
            <span className="truncate">
              {agentName(hit.agentType)} · {shortAge(hit.updatedAt)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ResultRow({
  children,
  label,
  onOpen,
}: {
  children: ReactNode;
  label?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="border-hair flex min-h-12 w-full items-center gap-3 border-t px-3.5 py-1 text-left first:border-t-0"
      onClick={onOpen}
    >
      {children}
    </button>
  );
}

function MessageRow({
  hit,
  onOpen,
}: {
  hit: SearchMessageHit;
  onOpen: () => void;
}) {
  return (
    <ResultRow onOpen={onOpen}>
      <span className="flex min-w-0 flex-1 flex-col">
        <Highlight
          text={hit.snippet}
          ranges={hit.ranges}
          className="text-foreground/90 truncate text-[14px]"
        />
        <span className="text-muted-foreground truncate text-[13px]">
          {messageMeta(
            hit.role,
            agentName(hit.agentType),
            hit.sessionName,
            shortAge(hit.ts)
          )}
        </span>
      </span>
    </ResultRow>
  );
}

function FileRow({ hit, onOpen }: { hit: SearchFileHit; onOpen: () => void }) {
  return (
    <ResultRow onOpen={onOpen}>
      <FileText
        aria-hidden
        className="text-muted-foreground h-[18px] w-[18px] flex-none"
      />
      <Highlight
        text={hit.path}
        ranges={hit.pathRanges}
        className="min-w-0 flex-1 truncate font-mono text-[13px]"
      />
      {hit.hits > 0 && (
        <span className="text-muted-foreground flex-none text-[13px]">
          {hit.hits === 1 ? "1 hit" : `${hit.hits} hits`}
        </span>
      )}
    </ResultRow>
  );
}

function CommandRow({
  hit,
  onOpen,
}: {
  hit: SearchCommand;
  onOpen: () => void;
}) {
  const Icon =
    hit.kind === "script"
      ? Play
      : hit.kind === "slash"
        ? SquareSlash
        : hit.action === "undo"
          ? Undo2
          : FileDiff;
  const trailing =
    hit.kind === "script" ? "Run" : hit.kind === "slash" ? "Insert" : "";
  return (
    <ResultRow label={`Command: ${hit.label}`} onOpen={onOpen}>
      <Icon
        aria-hidden
        className="h-[18px] w-[18px] flex-none text-violet-600 dark:text-violet-300"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px]">{hit.label}</span>
        {hit.detail && (
          <span className="text-muted-foreground truncate font-mono text-[12px]">
            {hit.detail}
          </span>
        )}
      </span>
      {hit.kind === "action" && (hit.added || hit.removed) ? (
        <span className="flex-none font-mono text-[12px]">
          {hit.added ? <span className="n-add">+{hit.added}</span> : null}{" "}
          {hit.removed ? <span className="n-del">−{hit.removed}</span> : null}
        </span>
      ) : trailing ? (
        <span className="text-muted-foreground flex-none text-[13px]">
          {trailing}
        </span>
      ) : null}
    </ResultRow>
  );
}
