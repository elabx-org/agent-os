"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAge } from "@/lib/agent-state";
import { haptic } from "@/lib/haptics";
import { registerNavHandlers } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";
import {
  mockChangesText,
  mockDecisionText,
  mockId,
  mockPreviewSrc,
  type Mock,
  type MockStatus,
} from "@/lib/mock-types";
import { useChangeMocks, useMocks } from "./data";

/**
 * What a mock's card needs from the chat it is in: a way to tell the
 * session, a way to start a reply, and which message links each mock last
 */
export interface MockChat {
  /** Sends as the user's message (through the queue, as the composer does) */
  send: (text: string) => Promise<void>;
  /** Puts text in the reply box and the cursor after it */
  draft: (text: string) => void;
  /** Mock id to the id of the last message linking it (lastMockMentions) */
  lastRow: ReadonlyMap<string, string>;
}

export const MockChatContext = createContext<MockChat | null>(null);
/** The chat message a Markdown block renders (its sourceId) */
export const MockRowContext = createContext<string | undefined>(undefined);

const STATUS_WORD: Record<MockStatus, string> = {
  ongoing: "Waiting for you",
  approved: "Approved",
  completed: "Built",
  rejected: "Rejected",
  abandoned: "Abandoned",
};

const STATUS_CLASS: Record<MockStatus, string> = {
  ongoing: "bg-amber-500/15 text-amber-700 dark:text-needs",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-work",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-work",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  abandoned: "bg-foreground/10 text-muted-foreground",
};

function StatusPill({ status }: { status: MockStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        STATUS_CLASS[status]
      )}
    >
      <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_WORD[status]}
    </span>
  );
}

/** Where it stands once decided, in a line under the card's text */
function decidedLine(mock: Mock): string | null {
  const you = mock.statusBy === "user";
  switch (mock.status) {
    case "approved":
      return you ? "You approved it. It's being built." : "Approved.";
    case "completed":
      return mock.pr ? `Built in ${mock.pr}.` : "Built.";
    case "rejected":
      return you ? "You rejected it." : "Rejected.";
    case "abandoned":
      return mock.statusNote ?? "No longer being worked on.";
    default:
      return null;
  }
}

/** Approve, Ask for changes, Reject: what each does, and whether one is going */
function useMockActions(mock: Mock, chat: MockChat, after?: () => void) {
  const change = useChangeMocks();
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const decide = useCallback(
    async (decision: "approved" | "rejected") => {
      if (busy) return;
      setBusy(decision);
      try {
        // The session first: a status with nobody told would mislead
        await chat.send(mockDecisionText(decision, mock.title));
        await change.mutateAsync({
          urls: [mock.url],
          change: { status: decision },
        });
        haptic("success");
        after?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't send it");
      } finally {
        setBusy(null);
      }
    },
    [busy, chat, change, mock.title, mock.url, after]
  );
  const askForChanges = useCallback(() => {
    after?.();
    chat.draft(mockChangesText(mock.title));
  }, [chat, mock.title, after]);
  return { busy, decide, askForChanges };
}

function ActionButtons({
  actions,
  className,
}: {
  actions: ReturnType<typeof useMockActions>;
  className?: string;
}) {
  const { busy, decide, askForChanges } = actions;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => void decide("approved")}
        disabled={!!busy}
        className="bg-primary text-primary-foreground inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold active:opacity-80 disabled:opacity-50"
      >
        {busy === "approved" ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <Check aria-hidden className="h-4 w-4" strokeWidth={2.4} />
        )}
        Approve
      </button>
      <button
        type="button"
        onClick={askForChanges}
        disabled={!!busy}
        className="bg-foreground/10 text-foreground inline-flex h-10 min-w-0 items-center rounded-full px-3 text-sm font-semibold active:opacity-80 disabled:opacity-50"
      >
        <span className="truncate">Ask for changes</span>
      </button>
      <button
        type="button"
        onClick={() => void decide("rejected")}
        disabled={!!busy}
        className="text-muted-foreground hover:text-foreground ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-1.5 text-sm font-semibold active:opacity-70 disabled:opacity-50"
      >
        {busy === "rejected" && (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        )}
        Reject
      </button>
    </div>
  );
}

/** The width an element has, kept current */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The closed Duo's and the open Duo's widths, as a mock is laid out for them */
const PAGE_WIDTH = { closed: 466, open: 951 } as const;
type PageSize = keyof typeof PAGE_WIDTH;

/**
 * The mock's page in a frame of its own: sandboxed, and served under a
 * policy that keeps it from AgentOS (lib/mocks.ts MOCK_PAGE_CSP)
 */
function MockFrame({
  mock,
  className,
  style,
  lazy,
}: {
  mock: Mock;
  className?: string;
  style?: React.CSSProperties;
  lazy?: boolean;
}) {
  return (
    <iframe
      title={`Mock: ${mock.title}`}
      src={mockPreviewSrc(mock.url, mock.versions)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading={lazy ? "lazy" : undefined}
      className={cn("block border-0 bg-white", className)}
      style={style}
    />
  );
}

/**
 * A mock's card in the chat: the page itself, where it stands, and the
 * decision. `full` is the last message linking it; earlier ones are a line
 */
function MockCard({
  mock,
  chat,
  full,
}: {
  mock: Mock;
  chat: MockChat;
  full: boolean;
}) {
  const [viewing, setViewing] = useState(false);
  const actions = useMockActions(mock, chat);
  const [stageRef, stage] = useWidth<HTMLButtonElement>();
  const scale = stage.width / PAGE_WIDTH.closed;
  const open = () => {
    if (mock.preview) setViewing(true);
    else window.open(mock.url, "_blank", "noopener,noreferrer");
  };
  const viewer = viewing && (
    <MockViewer mock={mock} chat={chat} onClose={() => setViewing(false)} />
  );

  if (!full || !mock.preview)
    return (
      <>
        <div className="bg-secondary/40 border-border/60 my-2 flex max-w-sm flex-col gap-2.5 rounded-2xl border p-2.5 first:mt-0 last:mb-0">
          <button
            type="button"
            onClick={open}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-foreground truncate font-semibold">
                {mock.title}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {!full
                  ? "Mock · its card is further down"
                  : "Mock · opens on claude.ai"}
              </span>
            </span>
            <StatusPill status={mock.status} />
            {mock.preview ? (
              <Maximize2
                aria-hidden
                className="text-muted-foreground h-4 w-4 shrink-0"
              />
            ) : (
              <ExternalLink
                aria-hidden
                className="text-muted-foreground h-4 w-4 shrink-0"
              />
            )}
          </button>
          {full && mock.status === "ongoing" && (
            <ActionButtons actions={actions} />
          )}
        </div>
        {viewer}
      </>
    );

  const decided = decidedLine(mock);
  return (
    <>
      <div className="bg-secondary/40 border-border/60 my-2 flex max-w-sm flex-col gap-2.5 rounded-[18px] border p-2.5 first:mt-0 last:mb-0">
        <button
          ref={stageRef}
          type="button"
          onClick={open}
          aria-label={`Open the mock ${mock.title} full screen`}
          className="relative block aspect-[2/1] w-full overflow-hidden rounded-[13px] bg-black/40 ring-1 ring-white/10 ring-inset"
        >
          {stage.width > 0 && (
            <MockFrame
              mock={mock}
              lazy
              className="pointer-events-none absolute top-0 left-0 origin-top-left"
              style={{
                width: PAGE_WIDTH.closed,
                height: stage.height / scale,
                transform: `scale(${scale})`,
              }}
            />
          )}
          <span
            aria-hidden
            className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur"
          >
            <Maximize2 className="h-4 w-4" />
          </span>
        </button>
        <div className="flex min-w-0 flex-col gap-1 px-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-foreground min-w-0 flex-1 truncate text-[15px] font-semibold">
              {mock.title}
            </span>
            <StatusPill status={mock.status} />
          </div>
          <span className="text-muted-foreground text-[13px] leading-snug">
            {mock.description && (
              <span className="line-clamp-2">{mock.description}</span>
            )}
            <span className="block">
              Version {mock.versions} · updated {shortAge(mock.updatedAt)}
              {shortAge(mock.updatedAt) === "now" ? "" : " ago"}
            </span>
          </span>
          {decided && (
            <span className="text-muted-foreground text-[13px]">{decided}</span>
          )}
        </div>
        {mock.status === "ongoing" && <ActionButtons actions={actions} />}
      </div>
      {viewer}
    </>
  );
}

/**
 * The mock full screen inside AgentOS: its page at the closed or the open
 * Duo's width (scaled to fit when the screen is narrower), a link to
 * claude.ai, and the same decision as its card
 */
function MockViewer({
  mock,
  chat,
  onClose,
}: {
  mock: Mock;
  chat: MockChat;
  onClose: () => void;
}) {
  const actions = useMockActions(mock, chat, onClose);
  const [stageRef, stage] = useWidth<HTMLDivElement>();
  const [size, setSize] = useState<PageSize>(() =>
    typeof window !== "undefined" && window.innerWidth >= 900
      ? "open"
      : "closed"
  );
  const width = PAGE_WIDTH[size];
  const scale = stage.width ? Math.min(1, stage.width / width) : 1;

  // The column's × (web and the iOS app's) and Esc close it
  useEffect(() => {
    mobileNavStore.sheet = "mock";
    const unregister = registerNavHandlers({ closeSheet: onClose });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey, true);
      if (mobileNavStore.sheet === "mock") mobileNavStore.sheet = null;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Mock: ${mock.title}`}
      className="bg-background text-foreground fixed inset-y-0 left-0 z-[60] flex flex-col pt-[env(safe-area-inset-top)]"
      style={{ right: "env(safe-area-inset-right)" }}
    >
      <div className="border-border/60 flex h-[52px] shrink-0 items-center gap-2.5 border-b pr-3 pl-[max(0.75rem,env(safe-area-inset-left))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the mock"
          className="bg-foreground/10 grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-70"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-tight font-semibold">
            {mock.title}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            Version {mock.versions}
            {mock.sessionName ? ` · from ${mock.sessionName}` : ""}
          </span>
        </div>
        <div
          role="group"
          aria-label="Lay the mock out for"
          className="bg-foreground/[0.07] flex shrink-0 rounded-full p-0.5"
        >
          {(["closed", "open"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={size === s}
              onClick={() => setSize(s)}
              className={cn(
                "h-8 rounded-full px-3 text-[13px] font-semibold",
                size === s
                  ? "bg-foreground/15 text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {s === "closed" ? "Closed" : "Open"}
            </button>
          ))}
        </div>
        <a
          href={mock.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on claude.ai"
          className="bg-foreground/10 grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-70"
        >
          <ExternalLink aria-hidden className="h-4 w-4" />
        </a>
      </div>
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-black/30"
      >
        {stage.width > 0 && (
          <MockFrame
            mock={mock}
            className="absolute top-0 origin-top-left"
            style={{
              width,
              height: stage.height / scale,
              left: Math.max(0, (stage.width - width * scale) / 2),
              transform: `scale(${scale})`,
            }}
          />
        )}
      </div>
      <div className="border-border/60 bg-card flex shrink-0 items-center gap-2 border-t px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {mock.status === "ongoing" ? (
          <ActionButtons actions={actions} className="flex-1" />
        ) : (
          <>
            <StatusPill status={mock.status} />
            <span className="text-muted-foreground min-w-0 truncate text-[13px]">
              {decidedLine(mock)}
            </span>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * A lone link to an artifact in the chat. One AgentOS tracks as a mock gets
 * its card; anything else (and any link outside a chat) stays the link card
 */
export function MockLink({
  href,
  fallback,
}: {
  href: string;
  fallback: ReactNode;
}) {
  const chat = useContext(MockChatContext);
  if (!chat) return <>{fallback}</>;
  return <TrackedMockLink href={href} chat={chat} fallback={fallback} />;
}

function TrackedMockLink({
  href,
  chat,
  fallback,
}: {
  href: string;
  chat: MockChat;
  fallback: ReactNode;
}) {
  const rowId = useContext(MockRowContext);
  const { data } = useMocks();
  const id = mockId(href);
  const mock = id ? data?.find((m) => mockId(m.url) === id) : undefined;
  if (!mock || !id) return <>{fallback}</>;
  const last = chat.lastRow.get(id);
  return (
    <MockCard
      mock={mock}
      chat={chat}
      full={!rowId || !last || last === rowId}
    />
  );
}
