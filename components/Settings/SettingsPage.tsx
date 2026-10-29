"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSnapshot } from "valtio";
import { useLongPress } from "@/hooks/useLongPress";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Film,
  FlaskConical,
  Columns2,
  Globe,
  Keyboard,
  Settings,
  SlidersHorizontal,
  Type,
  Zap,
} from "lucide-react";
import { AgentRow, SectionHeader } from "@/components/rows/AgentRow";
import { isNative, postToNative } from "@/lib/native-bridge";
import { postureStore } from "@/stores/posture";
import { mobileNavStore } from "@/stores/mobileNav";
import { useClaudeUsage } from "@/components/UsageMonitor";
import {
  DENSITY_EVENT,
  getDisplayClass,
  getOffset,
} from "@/lib/display-density";
import type { PushSettingsView } from "@/app/api/push/route";
import { duoPreviewStore } from "@/stores/duoPreview";
import {
  closeSettings,
  settingsPageStore,
  type SettingsSection,
} from "@/stores/settingsPage";
import { cn } from "@/lib/utils";
import { fetchBuild } from "@/hooks/useUpdatePrompt";
import {
  NotificationsSection,
  type NotificationsSectionProps,
} from "./NotificationsSection";
import { DisplaySection, themeLabel } from "./DisplaySection";
import { DuoSection } from "./DuoSection";
import { KeysSection } from "./KeysSection";
import { UsageSection } from "./UsageSection";
import { ClaudeCodeSection } from "./ClaudeCodeSection";
import { SessionsSection } from "./SessionsSection";
import { UploadsSection } from "./UploadsSection";
import { LabsSection } from "./LabsSection";
import { SettingGroup } from "./SettingGroup";

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

const SECTION_ICON = {
  notifications: Bell,
  display: Type,
  keys: Keyboard,
  duo: Columns2,
  usage: Zap,
  claude: SlidersHorizontal,
  sessions: CircleStop,
  uploads: Film,
  server: Globe,
  labs: FlaskConical,
} satisfies Record<SettingsSection, unknown>;

/**
 * Settings as a solid page over everything: one scrolling page when narrow,
 * a section list beside the chosen section when wide (the open iPhone Duo's
 * two pages, either side of the fold in book pose).
 */
/** What runs: the server's release, and the app's when in it */
function VersionLine({ className }: { className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const revealLabs = () => {
    settingsPageStore.labs = true;
    settingsPageStore.section = "labs";
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
      className={cn("text-muted-foreground text-xs select-none", className)}
    >
      {data?.version && `Agent-OS v${data.version}`}
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
  const { section, labs } = useSnapshot(settingsPageStore);
  const { fold } = useSnapshot(postureStore);
  const { on: duoTrial } = useSnapshot(duoPreviewStore);
  const { theme } = useTheme();
  const { railWidth } = useSnapshot(mobileNavStore);
  const narrow = useNarrow();
  // Only ever mounted in the browser, so no hydration to match
  const native = isNative();
  const backRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // Modal for real: the app behind can't take focus or keys (the terminal
  // would), and focus goes back where it was on close. Off the terminal (and
  // the iOS keyboard), so Esc and back work at once.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const layer = layerRef.current;
    const behind = [...(layer?.parentElement?.children ?? [])].filter(
      (el): el is HTMLElement =>
        el !== layer && el instanceof HTMLElement && !el.inert
    );
    behind.forEach((el) => (el.inert = true));
    backRef.current?.focus();
    return () => {
      behind.forEach((el) => (el.inert = false));
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Capture: the terminal swallows Esc otherwise. A dialog opened from here
  // (usage details) closes first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      e.preventDefault();
      closeSettings();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // The Duo and Server sections are the iOS app's
  const base: SettingsSection[] = native
    ? [
        "notifications",
        "display",
        "duo",
        "usage",
        "claude",
        "sessions",
        "uploads",
        "server",
      ]
    : ["notifications", "display", "usage", "claude", "sessions", "uploads"];
  const sections: SettingsSection[] = labs ? [...base, "labs"] : base;
  const current = sections.includes(section) ? section : "notifications";

  const phone = usePhoneSummary(current);
  const textSize = useTextSize();
  const { data: usage } = useClaudeUsage();

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

  const summary: Record<SettingsSection, string> = {
    notifications: phone ?? `Sound ${props.settings.sound ? "on" : "off"}`,
    // The variant alone: "Graphite", not "Dark · Graphite"
    display: `Text size ${textSize > 0 ? "+" : ""}${textSize} · ${themeLabel(theme).split(" · ").pop()}`,
    keys: "Adaptive",
    duo: `Closed layout · ${duoTrial ? "title in page" : "standard"}`,
    usage:
      usage && !usage.error
        ? `${usage.plan} · ${Math.round(usage.seven_day.utilization ?? 0)}% this week`
        : "Plan limits",
    claude: "Claude Config",
    sessions: "Kill all sessions",
    uploads: "Video frames",
    labs: "Kill switches",
    server: typeof window !== "undefined" ? window.location.host : "",
  };

  const backButton = (
    <button
      ref={backRef}
      type="button"
      onClick={closeSettings}
      aria-label="Close settings"
      className="text-muted-foreground active:bg-accent hover:bg-accent relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg after:absolute after:-inset-[5px] after:content-['']"
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  );

  const layer =
    "bg-background fixed inset-0 z-[45] flex pt-[env(safe-area-inset-top)]";
  // Clear of the iOS app's system column on the right. In a browser with the
  // nav rail in that column, stop at the rail and leave it usable
  const rightInset = railWidth
    ? ""
    : "pr-[var(--safe-right,env(safe-area-inset-right))]";
  const layerStyle = railWidth ? { right: railWidth } : undefined;

  if (narrow) {
    return (
      <div
        ref={layerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={layerStyle}
        className={cn(
          layer,
          rightInset,
          "flex-col pl-[env(safe-area-inset-left)]"
        )}
      >
        <header className="border-border flex items-center gap-2.5 border-b px-3 pt-2 pb-2.5">
          {backButton}
          <h1 className="text-[15px] font-semibold">Settings</h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {sections.map((s) => (
            <section key={s}>
              <SectionHeader className="px-5 pt-4">
                {SECTION_TITLE[s]}
              </SectionHeader>
              {body[s]}
            </section>
          ))}
          <VersionLine className="px-5 pt-6" />
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
      style={layerStyle}
      className={layer}
    >
      <aside
        style={listStyle}
        className={cn(
          "flex shrink-0 flex-col pl-[env(safe-area-inset-left)]",
          !book && "border-border border-r",
          !book && (native ? "w-[455px]" : "w-[40%] min-w-[300px]")
        )}
      >
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          {backButton}
          <Settings className="h-[17px] w-[17px]" aria-hidden="true" />
          <h1 className="text-base font-semibold">Settings</h1>
        </div>
        <nav
          aria-label="Settings sections"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          {sections.map((s) => (
            <AgentRow
              key={s}
              kind="setting"
              state="idle"
              icon={SECTION_ICON[s]}
              title={SECTION_TITLE[s]}
              subtitle={summary[s]}
              dense
              selected={s === current && s !== "server"}
              onClick={() => {
                if (s === "server") postToNative({ type: "server" });
                else settingsPageStore.section = s;
              }}
              trailing={
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground h-4 w-4"
                />
              }
            />
          ))}
          <VersionLine className="px-3 pt-4" />
        </nav>
      </aside>
      {book && (
        <div aria-hidden="true" style={{ width: book.end - book.start }} />
      )}
      <main
        className={cn(
          "min-w-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          rightInset
        )}
      >
        <header className="border-border flex min-h-[50px] items-center border-b px-5 pt-3 pb-2">
          <h2 className="text-[15px] font-semibold">
            {SECTION_TITLE[current]}
          </h2>
        </header>
        <div className="mx-auto max-w-2xl pt-2">{body[current]}</div>
      </main>
    </div>
  );
}

/** "ntfy on", from the server's phone channels; re-read on each section */
function usePhoneSummary(section: SettingsSection): string | null {
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
  const on = [data.ntfy.enabled && "ntfy", data.apns.enabled && "Apple push"];
  const channels = on.filter(Boolean).join(" + ");
  return channels ? `${channels} on` : "Phone alerts off";
}

/** This display's text size step, following A− / A+ */
function useTextSize(): number {
  const [offset, setOffset] = useState(() => getOffset(getDisplayClass()));
  useEffect(() => {
    const update = () => setOffset(getOffset(getDisplayClass()));
    window.addEventListener(DENSITY_EVENT, update);
    return () => window.removeEventListener(DENSITY_EVENT, update);
  }, []);
  return offset;
}

/**
 * Under 768px, like useViewport, but right on the first render: this only
 * mounts in the browser, and a wide first frame would steal the back
 * button's focus when it swaps.
 */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return narrow;
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
      trailing={
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground h-4 w-4"
        />
      }
    />
  );
}
