"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  Play,
  Search,
  SquareSlash,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { termRanges } from "@/lib/search/highlight";
import {
  MIN_QUERY,
  type SearchCommand,
  type SearchFileHit,
  type SearchMessageHit,
  type SearchSessionHit,
} from "@/lib/search/types";
import { STATE_WORD, sessionState, shortAge } from "@/lib/agent-state";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { StateDot } from "@/components/a/StateDot";
import type { SessionStatus } from "@/components/views/types";
import { isMacLike } from "@/hooks/useViewShortcuts";
import { useProjectsQuery } from "@/data/projects";
import { statusKeys } from "@/data/sessions/keys";
import { useSearch } from "@/data/search";
import { searchQueryStore } from "@/stores/searchActions";
import { Highlight } from "./Highlight";
import { useOpenSearchResult } from "./useOpenSearchResult";
import {
  EMPTY_SECTIONS,
  FILTER_LABEL,
  moveSelection,
  nextFilter,
  paletteRows,
  paletteSections,
  recentSessionHits,
  resultKey,
  resultsCurrent,
  type PaletteFilter,
  type PaletteSections,
} from "./palette-model";
import type { SearchResult, SearchSurfaceProps } from "./types";

/**
 * Desktop ⌘K palette (D-Search): input with result count and esc, sections
 * Sessions, Messages, Actions · <session>, Files, Commands; ↑↓ move, ↵ open,
 * ⌘↵ open beside, tab cycles the filter. With nothing typed it's the quick
 * switcher: the recent sessions.
 */
export function SearchPalette(props: SearchSurfaceProps) {
  const { open, onOpenChange } = props;
  // Content unmounts once closed, so the body starts fresh on each open
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40 dark:bg-black/60" />
        <DialogPrimitive.Content
          aria-label="Search everything"
          className={cn(
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]",
            "fixed top-[104px] left-1/2 z-50 flex max-h-[calc(100dvh-136px)] w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden",
            "rounded-[20px] border border-[var(--glass-border)] bg-[var(--sheet)] shadow-[0_30px_80px_rgba(0,0,0,0.25)] outline-none dark:shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Search everything
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Find sessions, messages, files and commands
          </DialogPrimitive.Description>
          <PaletteBody {...props} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The mocks' .kc keycap */
function Keycap({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "border-foreground/10 text-foreground/85 bg-foreground/[0.08] inline-flex h-[22px] min-w-[22px] flex-none items-center justify-center rounded-md border px-1.5 font-mono text-[11px] font-normal",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/** The mocks' .oi: a small icon tile in front of a row */
function IconTile({
  icon: Icon,
  accent,
}: {
  icon: LucideIcon;
  accent?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-[var(--sheet-fill)]",
        accent ? "text-[#6D28D9] dark:text-[#C4B5FD]" : "text-foreground/75"
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

interface Section {
  key: keyof PaletteSections;
  label: string;
  rows: SearchResult[];
}

function PaletteBody(props: SearchSurfaceProps) {
  const { sessions, currentSessionId } = props;
  const [query, setQuery] = useState(() => searchQueryStore.query);
  const [filter, setFilter] = useState<PaletteFilter>("all");
  const [index, setIndex] = useState(0);
  const openResult = useOpenSearchResult(props);
  const mac = isMacLike();
  useEffect(() => {
    searchQueryStore.query = query;
  }, [query]);

  const { data: projects } = useProjectsQuery();
  const projectNames = useMemo(
    () => Object.fromEntries((projects ?? []).map((p) => [p.id, p.name])),
    [projects]
  );
  // The sidebar's statuses, from the cache the page keeps polling
  const { data: statusData } = useQuery<{
    statuses: Record<string, SessionStatus>;
  }>({ queryKey: statusKeys.all, enabled: false });
  const statuses = statusData?.statuses;
  const sessionsById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions]
  );

  const current = currentSessionId
    ? sessionsById.get(currentSessionId)
    : undefined;
  const q = query.trim();
  const searching = q.length >= MIN_QUERY;
  const search = useSearch(
    {
      q: query,
      sessionId: currentSessionId,
      projectId: current?.project_id ?? undefined,
    },
    true
  );
  // Placeholder data outlives a cleared query: only while searching
  const data = searching ? search.data : undefined;
  const messagesEnabled = search.data?.messagesEnabled ?? true;
  const shownFilter: PaletteFilter =
    filter === "messages" && !messagesEnabled ? "all" : filter;
  const loading =
    searching &&
    !search.isError &&
    (search.isFetching || search.isPlaceholderData || !data);

  const sections = useMemo<PaletteSections>(() => {
    if (searching) return paletteSections(data, shownFilter);
    if (shownFilter !== "all" && shownFilter !== "sessions")
      return EMPTY_SECTIONS;
    return {
      ...EMPTY_SECTIONS,
      sessions: recentSessionHits(sessions, projectNames, q).map((hit) => ({
        kind: "session",
        hit,
      })),
    };
  }, [searching, data, shownFilter, sessions, projectNames, q]);
  const rows = useMemo(() => paletteRows(sections), [sections]);
  const selected = Math.min(index, Math.max(0, rows.length - 1));

  const list: Section[] = [
    {
      key: "sessions",
      label: searching ? "Sessions" : "Recent sessions",
      rows: sections.sessions,
    },
    { key: "messages", label: "Messages", rows: sections.messages },
    {
      key: "actions",
      label: data?.sessionName ? `Actions · ${data.sessionName}` : "Actions",
      rows: sections.actions,
    },
    { key: "files", label: "Files", rows: sections.files },
    { key: "commands", label: "Commands", rows: sections.commands },
  ];

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, rows]);

  const pick = (
    result: SearchResult | undefined,
    beside: boolean,
    fromKeyboard = false
  ) => {
    if (result) openResult(result, { beside, fromKeyboard });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        setIndex(
          moveSelection(selected, e.key === "ArrowDown" ? 1 : -1, rows.length)
        );
        break;
      case "Enter":
        e.preventDefault();
        // Rows of the previous query stay up while the next one loads:
        // Enter waits for the current ones
        if (searching && !resultsCurrent(data, q, search.isPlaceholderData))
          break;
        pick(rows[selected], e.metaKey || e.ctrlKey, true);
        break;
      case "Tab":
        e.preventDefault();
        setFilter(
          nextFilter(shownFilter, e.shiftKey ? -1 : 1, messagesEnabled)
        );
        setIndex(0);
        break;
    }
  };

  const age = (value: string) => shortAge(value);
  let at = 0;

  return (
    <>
      <div className="flex h-[60px] flex-none items-center gap-3 border-b border-[var(--hair)] px-5">
        <Search
          aria-hidden
          className="text-muted-foreground h-5 w-5 flex-none"
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          // The last query comes back selected: typing starts a new one
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Search sessions, messages, files"
          aria-label="Search everything"
          role="combobox"
          aria-expanded
          aria-controls="search-palette-list"
          aria-activedescendant={
            rows.length ? `search-palette-opt-${selected}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[17px] outline-none"
        />
        {loading && (
          <Loader2
            aria-label="Searching"
            className="text-muted-foreground h-4 w-4 flex-none animate-spin"
          />
        )}
        {searching && data && (
          <span className="text-muted-foreground flex-none text-[13px]">
            {rows.length} {rows.length === 1 ? "result" : "results"}
          </span>
        )}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => props.onOpenChange(false)}
          aria-label="Close"
          className="flex-none"
        >
          <Keycap>esc</Keycap>
        </button>
      </div>

      <div
        id="search-palette-list"
        role="listbox"
        aria-label="Results"
        className="min-h-0 flex-1 overflow-y-auto pb-2"
      >
        {list.map((section) => {
          if (!section.rows.length) return null;
          return (
            <div key={section.key} role="group" aria-label={section.label}>
              <div className="text-muted-foreground px-5 pt-3 pb-1.5 text-xs font-semibold">
                {section.label}
              </div>
              {section.rows.map((result) => {
                const i = at++;
                const isSel = i === selected;
                const two = result.kind === "message";
                return (
                  <div
                    key={resultKey(result)}
                    id={`search-palette-opt-${i}`}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    role="option"
                    aria-selected={isSel}
                    onMouseMove={() => {
                      if (index !== i) setIndex(i);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => pick(result, e.metaKey || e.ctrlKey)}
                    className={cn(
                      "mx-2 flex cursor-pointer items-center gap-3 rounded-xl px-3 text-sm",
                      two ? "min-h-14 py-1.5" : "min-h-12",
                      isSel && "bg-primary/[0.22]"
                    )}
                  >
                    <ResultRow
                      result={result}
                      query={q}
                      selected={isSel}
                      session={
                        result.kind === "session"
                          ? sessionsById.get(result.hit.id)
                          : undefined
                      }
                      status={
                        result.kind === "session"
                          ? statuses?.[result.hit.id]?.status
                          : undefined
                      }
                      age={age}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
        {searching && !loading && rows.length === 0 && (
          <div className="text-muted-foreground px-5 py-10 text-center text-sm">
            {search.isError
              ? (search.error as Error)?.message || "Search failed"
              : `No results for “${q}”`}
          </div>
        )}
        {!searching && rows.length === 0 && (
          <div className="text-muted-foreground px-5 py-10 text-center text-sm">
            {sessions.length ? `No sessions match “${q}”` : "No sessions yet"}
          </div>
        )}
      </div>

      <div className="text-muted-foreground flex h-12 flex-none items-center gap-[18px] border-t border-[var(--hair)] bg-[var(--sheet-fill)] px-5 text-[13px]">
        <span className="flex items-center gap-1.5">
          <Keycap>↑</Keycap>
          <Keycap>↓</Keycap>
          Move
        </span>
        <span className="flex items-center gap-1.5">
          <Keycap>↵</Keycap>
          Open
        </span>
        <span className="flex items-center gap-1.5">
          <Keycap>{mac ? "⌘" : "Ctrl"}</Keycap>
          <Keycap>↵</Keycap>
          Open beside
        </span>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setFilter(nextFilter(shownFilter, 1, messagesEnabled));
            setIndex(0);
          }}
          className="ml-auto flex items-center gap-1.5"
        >
          <Keycap>tab</Keycap>
          Filter: {FILTER_LABEL[shownFilter]}
        </button>
      </div>
    </>
  );
}

function ResultRow({
  result,
  query,
  selected,
  session,
  status,
  age,
}: {
  result: SearchResult;
  query: string;
  selected: boolean;
  session: Session | undefined;
  status: string | undefined;
  age: (value: string) => string;
}) {
  switch (result.kind) {
    case "session":
      return (
        <SessionRow
          hit={result.hit}
          selected={selected}
          session={session}
          status={status}
          age={age}
        />
      );
    case "message":
      return <MessageRow hit={result.hit} age={age} />;
    case "file":
      return <FileRow hit={result.hit} />;
    case "command":
      return <CommandRow hit={result.hit} query={query} />;
  }
}

function SessionRow({
  hit,
  selected,
  session,
  status,
  age,
}: {
  hit: SearchSessionHit;
  selected: boolean;
  session: Session | undefined;
  status: string | undefined;
  age: (value: string) => string;
}) {
  const state = sessionState(session ?? {}, status);
  const lit = state === "needs" || state === "work";
  const meta = [
    hit.projectName,
    `${STATE_WORD[state].toLowerCase()} ${age(hit.updatedAt)}`.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <Avatar {...agentAvatar(hit.agentType)} size="sm" />
      <Highlight
        text={hit.name}
        ranges={hit.nameRanges}
        className="min-w-0 flex-1 truncate"
      />
      <span className="text-muted-foreground flex max-w-[45%] flex-none items-center gap-1.5 text-[13px]">
        {lit && <StateDot state={state} size={6} />}
        <span className="truncate">{meta}</span>
      </span>
      {selected && <Keycap>↵</Keycap>}
    </>
  );
}

function MessageRow({
  hit,
  age,
}: {
  hit: SearchMessageHit;
  age: (value: string) => string;
}) {
  const who = hit.role === "user" ? "You" : agentName(hit.agentType);
  return (
    <>
      <IconTile icon={MessageSquare} />
      <span className="flex min-w-0 flex-1 flex-col">
        <Highlight
          text={hit.snippet}
          ranges={hit.ranges}
          className="text-foreground/90 truncate"
        />
        <span className="text-muted-foreground truncate text-[13px]">
          {who} · {hit.sessionName}
        </span>
      </span>
      <span className="text-muted-foreground flex-none text-[13px]">
        {age(hit.ts)}
      </span>
    </>
  );
}

function FileRow({ hit }: { hit: SearchFileHit }) {
  return (
    <>
      <IconTile icon={FileText} />
      <Highlight
        text={hit.path}
        ranges={hit.pathRanges}
        className="min-w-0 flex-1 truncate font-mono text-[13px]"
      />
      {hit.hits > 0 && (
        <span className="text-muted-foreground flex-none text-[13px]">
          {hit.hits} {hit.hits === 1 ? "hit" : "hits"}
        </span>
      )}
    </>
  );
}

const COMMAND_ICON: Record<SearchCommand["kind"], LucideIcon> = {
  script: Play,
  slash: SquareSlash,
  action: Undo2,
};

function CommandRow({ hit, query }: { hit: SearchCommand; query: string }) {
  const icon =
    hit.kind === "action" && hit.action === "diff"
      ? GitBranch
      : COMMAND_ICON[hit.kind];
  const delta =
    hit.kind === "action" &&
    hit.action === "diff" &&
    (hit.added !== undefined || hit.removed !== undefined);
  return (
    <>
      <IconTile icon={icon} accent={hit.kind === "action"} />
      <Highlight
        text={hit.label}
        ranges={termRanges(hit.label, query)}
        className="min-w-0 flex-1 truncate"
      />
      {delta && hit.kind === "action" ? (
        <span className="flex flex-none items-center gap-1.5 font-mono text-xs">
          <span className="text-[var(--add)]">+{hit.added ?? 0}</span>
          <span className="text-[var(--del)]">−{hit.removed ?? 0}</span>
        </span>
      ) : (
        hit.detail && (
          <span
            className={cn(
              "text-muted-foreground max-w-[50%] flex-none truncate text-[13px]",
              hit.kind === "script" && "font-mono text-xs"
            )}
          >
            {hit.detail}
          </span>
        )
      )}
    </>
  );
}
