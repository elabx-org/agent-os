"use client";

import {
  useEffect,
  useRef,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { useSnapshot } from "valtio";
import { useLongPress } from "@/hooks/useLongPress";
import { useQuery } from "@tanstack/react-query";
import {
  Asterisk,
  Bell,
  ChevronLeft,
  Columns2,
  Contrast,
  FlaskConical,
  Globe,
  Keyboard,
  Terminal,
  Video,
  X,
  Zap,
} from "lucide-react";
import { AgentRow } from "@/components/rows/AgentRow";
import { GroupCard, GroupRow } from "@/components/a";
import { isNative, nativeCaps, postToNative } from "@/lib/native-bridge";
import { postureStore } from "@/stores/posture";
import { mobileNavStore } from "@/stores/mobileNav";
import { layoutStore, type LayoutMode } from "@/hooks/useLayoutMode";
import { useSyncedLook } from "@/hooks/useSyncedLook";
import { useClaudeUsage } from "@/components/UsageMonitor";
import { useToolbarPreferences } from "@/components/Terminal/toolbar-config";
import { formatReset } from "@/lib/usage-reset";
import { lookSummary } from "@/lib/look-sync";
import type { PushSettingsView } from "@/app/api/push/route";
import type { SessionStatus } from "@/components/views/types";
import { statusKeys } from "@/data/sessions/keys";
import { duoPreviewStore } from "@/stores/duoPreview";
import { PRESETS, loadUploadPrefs, uploadPrefs } from "@/stores/videoUploads";
import {
  closeSettings,
  settingsBack,
  settingsPageStore,
  showSettingsSection,
  type SettingsSection,
} from "@/stores/settingsPage";
import { cn } from "@/lib/utils";
import { fetchBuild } from "@/hooks/useUpdatePrompt";
import {
  NotificationsSection,
  type NotificationsSectionProps,
} from "./NotificationsSection";
import { DisplaySection } from "./DisplaySection";
import { DuoSection } from "./DuoSection";
import { KeysSection, keysSummary } from "./KeysSection";
import { UsageSection } from "./UsageSection";
import { ClaudeCodeSection } from "./ClaudeCodeSection";
import { SessionsSection } from "./SessionsSection";
import { UploadsSection } from "./UploadsSection";
import { LabsSection } from "./LabsSection";
import { Chevron, SettingGroup } from "./SettingGroup";

const SECTION_TITLE: Record<SettingsSection, string> = {
  notifications: "Notifications",
  display: "Display",
  keys: "Keys",
  duo: "iPhone Duo",
  usage: "Usage",
  claude: "Claude Code",
  sessions: "Sessions",
  uploads: "Uploads",
  server: "Server",
  labs: "Labs",
};

/** Each section's 30px tile: its icon on its own colour (Closed-Settings) */
const SECTION_TILE = {
  notifications: { icon: Bell, color: "#DC2626" },
  display: { icon: Contrast, color: "#2563EB" },
  keys: { icon: Keyboard, color: "#52525B" },
  duo: { icon: Columns2, color: "#4F46E5" },
  usage: { icon: Zap, color: "#6D28D9" },
  claude: { icon: Asterisk, color: "#C2410C" },
  sessions: { icon: Terminal, color: "#3F3F46" },
  uploads: { icon: Video, color: "#047857" },
  server: { icon: Globe, color: "#0284C7" },
  labs: { icon: FlaskConical, color: "#A16207" },
} satisfies Record<
  SettingsSection,
  { icon: ComponentType<{ className?: string }>; color: string }
>;

/** The list|detail split: the open Duo (flat or book) and desktops */
const SPLIT: readonly LayoutMode[] = ["duo-open", "book", "desktop"];

function Tile({ section }: { section: SettingsSection }) {
  const { icon: Icon, color } = SECTION_TILE[section];
  return (
    <span
      aria-hidden="true"
      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-white"
      style={{ backgroundColor: color }}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** What runs: the server's release, and the app's when in it */
function VersionLine({ className }: { className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const revealLabs = () => {
    settingsPageStore.labs = true;
    showSettingsSection("labs");
  };
  // Hidden on purpose: a long press (a double click on desktop) shows Labs
  useLongPress(ref, revealLabs);
  const { data } = useQuery({
    queryKey: ["build"],
    queryFn: fetchBuild,
    staleTime: 60_000,
  });
  const app =
    typeof window !== "undefined" ? window.agentosNative?.version : undefined;
  if (!data?.version && !app) return null;
  return (
    <p
      ref={ref}
      onDoubleClick={revealLabs}
      className={cn(
        "text-muted-foreground px-[calc(var(--settings-gutter-l,20px)+4px)] text-[13px] select-none",
        className
      )}
    >
      {data?.version && `Agent-OS ${data.version}`}
      {data?.version && app && " · "}
      {app && `iOS app ${app}`}
    </p>
  );
}

export function SettingsPage(props: NotificationsSectionProps) {
  const { open } = useSnapshot(settingsPageStore);
  if (!open) return null;
  return <SettingsLayer {...props} />;
}

function SettingsLayer(props: NotificationsSectionProps) {
  const { section, detail, labs } = useSnapshot(settingsPageStore);
  const { fold } = useSnapshot(postureStore);
  const { on: duoTrial } = useSnapshot(duoPreviewStore);
  const { preset } = useSnapshot(uploadPrefs);
  const { railWidth } = useSnapshot(mobileNavStore);
  const layout = useSettingsLayout();
  const split = SPLIT.includes(layout);
  // Only ever mounted in the browser, so no hydration to match
  const native = isNative();
  // The column draws close/back and Server: the web column on the closed
  // Duo in Safari, the app's own once it takes the column spec. Otherwise
  // the page has its own.
  const nativeColumn = native && nativeCaps().column;
  const columnNav = nativeColumn || (!native && layout === "duo-closed");
  const navRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // Modal for real: the app behind can't take focus or keys (the terminal
  // would), and focus goes back where it was on close. Off the terminal (and
  // the iOS keyboard), so Esc and back work at once.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const layer = layerRef.current;
    // The web column or bar stays usable: it closes Settings and goes back
    const keep = [...document.querySelectorAll("[data-control-column]")];
    const behind: HTMLElement[] = [];
    const shut = (el: Element) => {
      if (el === layer || !(el instanceof HTMLElement) || el.inert) return;
      if (!keep.some((k) => el.contains(k))) behind.push(el);
      else if (!keep.includes(el)) [...el.children].forEach(shut);
    };
    [...(layer?.parentElement?.children ?? [])].forEach(shut);
    behind.forEach((el) => (el.inert = true));
    // The layer, not its close button: focus moved by script shows a ring
    layer?.focus();
    return () => {
      behind.forEach((el) => (el.inert = false));
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Capture: the terminal swallows Esc otherwise. A dialog opened from here
  // (usage details) closes first; a section on its own page goes back first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      e.preventDefault();
      if (split || !settingsBack()) closeSettings();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [split]);

  useEffect(loadUploadPrefs, []);

  // A section on its own page, or back on the list: from its top, with focus
  // on the page (the row tapped is gone)
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    // Split, the list stays put beside the section
    if (split) return;
    scrollRef.current?.scrollTo({ top: 0 });
    (navRef.current ?? layerRef.current)?.focus({ preventScroll: true });
  }, [detail, section, split]);

  // The list. Usage is the card above it; iPhone Duo and Server are the iOS
  // app's (Server in its column once it has one); Keys are touch keys
  const rows: SettingsSection[] = [
    "notifications",
    "display",
    ...(layout !== "desktop" || native ? (["keys"] as const) : []),
    ...(native ? (["duo"] as const) : []),
    "claude",
    "uploads",
    "sessions",
    ...(native && !nativeColumn ? (["server"] as const) : []),
    ...(labs ? (["labs"] as const) : []),
  ];
  const sections: SettingsSection[] = [...rows, "usage"];
  const current = sections.includes(section) ? section : "notifications";

  const notificationsOn = useNotificationsOn(current, props);
  const running = useRunningCount();
  const { look } = useSyncedLook();
  const { preferences: keys } = useToolbarPreferences();

  const body: Record<SettingsSection, ReactNode> = {
    notifications: <NotificationsSection {...props} />,
    display: <DisplaySection />,
    keys: <KeysSection />,
    duo: <DuoSection />,
    usage: <UsageSection />,
    claude: <ClaudeCodeSection />,
    sessions: <SessionsSection />,
    uploads: <UploadsSection />,
    labs: <LabsSection />,
    server: (
      <SettingGroup className="divide-y-0 p-1">
        <ServerRow />
      </SettingGroup>
    ),
  };

  const value: Partial<Record<SettingsSection, string>> = {
    notifications:
      notificationsOn === null ? undefined : notificationsOn ? "On" : "Off",
    display: lookSummary(look),
    keys: keysSummary(keys),
    duo: duoTrial ? "Title in page" : "Classic header",
    uploads: PRESETS[preset].label,
    sessions: running === null ? undefined : `${running} running`,
    server: typeof window !== "undefined" ? window.location.host : undefined,
  };

  const open = (s: SettingsSection) => {
    if (s === "server") postToNative({ type: "server" });
    else showSettingsSection(s);
  };

  const list = (
    <div className="flex flex-col gap-4">
      <UsageCard
        selected={split && current === "usage"}
        onClick={() => open("usage")}
      />
      <GroupCard
        aria-label="Settings sections"
        className="mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)]"
      >
        {rows.map((s) => (
          <GroupRow
            key={s}
            leading={<Tile section={s} />}
            title={<span className="text-[16px]">{SECTION_TITLE[s]}</span>}
            trailing={
              value[s] && (
                <span className="text-muted-foreground shrink-0 text-[14px]">
                  {value[s]}
                </span>
              )
            }
            chevron
            selected={split && s === current}
            onClick={() => open(s)}
          />
        ))}
      </GroupCard>
      <VersionLine />
    </div>
  );

  const layer =
    "bg-background fixed inset-0 z-[45] flex pt-[env(safe-area-inset-top)] outline-none";
  // Clear of the iOS app's system column on the right. In a browser with the
  // nav rail in that column, stop at the rail and leave it usable
  const rightInset = railWidth
    ? ""
    : "pr-[var(--safe-right,env(safe-area-inset-right))]";
  const layerStyle = railWidth ? { right: railWidth } : undefined;
  const scroll =
    "min-h-0 flex-1 overflow-y-auto overscroll-contain pt-[18px] pb-[calc(1.5rem+max(env(safe-area-inset-bottom),var(--control-bar-h,0px)))]";
  const title = "t-large px-[var(--settings-gutter-l,20px)]";

  if (!split) {
    const navButton = columnNav ? null : detail ? (
      <NavButton
        ref={navRef}
        label="Back to Settings"
        onClick={() => settingsBack()}
      >
        <ChevronLeft className="h-5 w-5" />
      </NavButton>
    ) : (
      <NavButton ref={navRef} label="Close settings" onClick={closeSettings}>
        <X className="h-5 w-5" />
      </NavButton>
    );
    return (
      <div
        ref={layerRef}
        role="dialog"
        // The web column outside it closes it and goes back, so VoiceOver
        // must reach it (inert keeps the rest behind out)
        aria-modal={columnNav && !nativeColumn ? undefined : true}
        aria-label="Settings"
        tabIndex={-1}
        style={{ ...layerStyle, ...gutters(columnNav ? 8 : 20) }}
        className={cn(
          layer,
          rightInset,
          "flex-col pl-[env(safe-area-inset-left)]"
        )}
      >
        <div ref={scrollRef} className={scroll}>
          {navButton && <div className="-mt-2 px-3 pb-1">{navButton}</div>}
          {detail ? (
            <>
              <h1 className={title}>{SECTION_TITLE[current]}</h1>
              <div className="pt-4">{body[current]}</div>
            </>
          ) : (
            <div className="flex flex-col gap-4">
              <h1 className={title}>Settings</h1>
              {list}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Book pose: the list is the left page, the section the right, and the
  // fold between them stays empty
  const book = fold?.axis === "vertical" ? fold : null;
  const listStyle = book ? { width: book.start } : undefined;

  return (
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabIndex={-1}
      style={{ ...layerStyle, ...gutters(20) }}
      className={layer}
    >
      <aside
        style={listStyle}
        className={cn(
          "flex shrink-0 flex-col pl-[env(safe-area-inset-left)]",
          !book && "border-hair border-r",
          !book &&
            // Flat open Duo: the left page, up to the fold
            (layout === "duo-open"
              ? "w-[455px]"
              : "w-[40%] max-w-[440px] min-w-[300px]")
        )}
      >
        <nav aria-label="Settings sections" className={scroll}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pr-3">
              <h1 className={title}>Settings</h1>
              {!nativeColumn && (
                <NavButton
                  ref={navRef}
                  label="Close settings"
                  onClick={closeSettings}
                >
                  <X className="h-5 w-5" />
                </NavButton>
              )}
            </div>
            {list}
          </div>
        </nav>
      </aside>
      {book && (
        <div aria-hidden="true" style={{ width: book.end - book.start }} />
      )}
      <main
        className={cn(scroll, "min-w-0", rightInset)}
        // Flat open Duo: the section's cards keep clear of the fold
        style={
          layout === "duo-open" && !book
            ? ({
                "--settings-gutter-l": "calc(20px + var(--fold-clear, 0px))",
              } as CSSProperties)
            : undefined
        }
      >
        <div className="mx-auto max-w-2xl">
          <h2 className={title}>{SECTION_TITLE[current]}</h2>
          <div className="pt-4">{body[current]}</div>
        </div>
      </main>
    </div>
  );
}

/** The side margins every card on the page takes (SettingGroup reads them) */
function gutters(right: number): CSSProperties {
  return {
    "--settings-gutter-l": "20px",
    "--settings-gutter-r": `${right}px`,
  } as CSSProperties;
}

function NavButton({
  ref,
  label,
  onClick,
  children,
}: {
  ref: Ref<HTMLButtonElement>;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-muted-foreground active:bg-accent hover:bg-accent relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg after:absolute after:-inset-[5px] after:content-['']"
    >
      {children}
    </button>
  );
}

/** Claude's plan use at the top of Settings; opens Usage */
function UsageCard({
  selected,
  onClick,
}: {
  selected: boolean;
  onClick: () => void;
}) {
  const { data } = useClaudeUsage();
  const usage = data && !data.error ? data : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected || undefined}
      className={cn(
        "bg-card mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)] flex flex-col gap-2.5 rounded-[20px] p-3.5 text-left",
        selected && "ring-primary/60 ring-2"
      )}
    >
      <span className="flex items-center gap-2.5">
        <Tile section="usage" />
        <span className="min-w-0 flex-1 text-[16px] font-medium">
          Claude usage
        </span>
        <span className="text-muted-foreground shrink-0 text-[14px]">
          {usage ? usage.plan : "Not reported"}
        </span>
      </span>
      {usage && (
        <>
          <Meter
            label="Session"
            pct={usage.five_hour.utilization}
            resetsAt={usage.five_hour.resets_at}
          />
          <Meter
            label="Week"
            pct={usage.seven_day.utilization}
            resetsAt={usage.seven_day.resets_at}
          />
        </>
      )}
    </button>
  );
}

function Meter({
  label,
  pct,
  resetsAt,
}: {
  label: string;
  pct: number | null;
  resetsAt: string | null;
}) {
  const value = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const reset = formatReset(resetsAt, { style: "long" });
  return (
    <span className="flex flex-col gap-1.5">
      <span className="text-muted-foreground flex items-center justify-between text-[13px]">
        <span>
          <span className="text-foreground/90">{label}</span>
          {reset && ` · resets ${reset}`}
        </span>
        <span className="text-foreground/90 font-semibold tabular-nums">
          {value}%
        </span>
      </span>
      <span className="bg-foreground/10 block h-1.5 overflow-hidden rounded-[3px]">
        <span
          className="bg-primary dark:bg-meter block h-full min-w-1.5 rounded-[3px]"
          style={{ width: `${value}%` }}
        />
      </span>
    </span>
  );
}

/**
 * The posture, or (before the posture is first measured) the width: this
 * only mounts in the browser, and a wrong first frame would steal the nav
 * button's focus when it swaps.
 */
function useSettingsLayout(): LayoutMode {
  const { mode, hydrated } = useSnapshot(layoutStore);
  if (hydrated) return mode;
  return window.innerWidth < 768 ? "phone" : "desktop";
}

/**
 * Notifications on: a phone channel (ntfy, Apple push) or this device's
 * alerts. Re-read on each section; null until the server answers.
 */
function useNotificationsOn(
  section: SettingsSection,
  { settings, permissionGranted }: NotificationsSectionProps
): boolean | null {
  const { data, refetch } = useQuery<PushSettingsView>({
    queryKey: ["push-settings"],
    queryFn: async () => {
      const res = await fetch("/api/push");
      if (!res.ok) throw new Error("Failed to load push settings");
      return res.json();
    },
  });
  useEffect(() => {
    refetch();
  }, [section, refetch]);
  if (!data) return null;
  const device =
    settings.enabled && settings.browserNotifications && permissionGranted;
  return data.ntfy.enabled || data.apns.enabled || device;
}

/** Sessions whose tmux is alive, from the status poll the app already runs */
function useRunningCount(): number | null {
  const { data } = useQuery<{ statuses: Record<string, SessionStatus> }>({
    queryKey: statusKeys.all,
    queryFn: async () => {
      const res = await fetch("/api/sessions/status");
      if (!res.ok) throw new Error("Failed to fetch statuses");
      return res.json();
    },
    staleTime: 2000,
  });
  if (!data) return null;
  return Object.values(data.statuses).filter((s) => s.status !== "dead").length;
}

/** The iOS app keeps the server address and Face ID lock in its own screen */
function ServerRow() {
  return (
    <AgentRow
      kind="setting"
      state="idle"
      icon={Globe}
      title="Server"
      subtitle={`${window.location.host} · opens in the app`}
      dense
      onClick={() => postToNative({ type: "server" })}
      trailing={<Chevron />}
    />
  );
}
