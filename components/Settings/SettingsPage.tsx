"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSnapshot } from "valtio";
import { useTheme } from "next-themes";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Globe,
  Settings,
  Type,
  Zap,
} from "lucide-react";
import { AgentRow, SectionHeader } from "@/components/rows/AgentRow";
import { isNative, postToNative } from "@/lib/native-bridge";
import { postureStore } from "@/stores/posture";
import { duoPreviewStore } from "@/stores/duoPreview";
import {
  closeSettings,
  settingsPageStore,
  type SettingsSection,
} from "@/stores/settingsPage";
import { cn } from "@/lib/utils";
import {
  NotificationsSection,
  type NotificationsSectionProps,
} from "./NotificationsSection";
import { DisplaySection, themeLabel } from "./DisplaySection";
import { DuoSection } from "./DuoSection";
import { UsageSection } from "./UsageSection";
import { SettingGroup } from "./SettingGroup";

const SECTION_TITLE: Record<SettingsSection, string> = {
  notifications: "Notifications",
  display: "Display",
  duo: "iPhone Duo",
  usage: "Usage",
  server: "Server",
};

const SECTION_ICON = {
  notifications: Bell,
  display: Type,
  duo: Columns2,
  usage: Zap,
  server: Globe,
} satisfies Record<SettingsSection, unknown>;

/**
 * Settings as a solid page over everything: one scrolling page when narrow,
 * a section list beside the chosen section when wide (the open iPhone Duo's
 * two pages, either side of the fold in book pose).
 */
export function SettingsPage(props: NotificationsSectionProps) {
  const { open } = useSnapshot(settingsPageStore);
  if (!open) return null;
  return <SettingsLayer {...props} />;
}

function SettingsLayer(props: NotificationsSectionProps) {
  const { section } = useSnapshot(settingsPageStore);
  const { fold } = useSnapshot(postureStore);
  const { on: duoTrial } = useSnapshot(duoPreviewStore);
  const { theme } = useTheme();
  const narrow = useNarrow();
  // Only ever mounted in the browser, so no hydration to match
  const native = isNative();
  const backRef = useRef<HTMLButtonElement>(null);

  // Off the terminal (and the iOS keyboard), so Esc and back work at once
  useEffect(() => backRef.current?.focus(), []);

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
  const sections: SettingsSection[] = native
    ? ["notifications", "display", "duo", "usage", "server"]
    : ["notifications", "display", "usage"];
  const current = sections.includes(section) ? section : "notifications";

  const body: Record<SettingsSection, ReactNode> = {
    notifications: <NotificationsSection {...props} />,
    display: <DisplaySection />,
    duo: <DuoSection />,
    usage: <UsageSection />,
    server: (
      <SettingGroup className="divide-y-0 p-1">
        <ServerRow />
      </SettingGroup>
    ),
  };

  const summary: Record<SettingsSection, string> = {
    notifications: `Sound ${props.settings.sound ? "on" : "off"} · browser alerts ${
      props.settings.browserNotifications && props.permissionGranted
        ? "on"
        : "off"
    }`,
    display: themeLabel(theme),
    duo: `Closed-screen trial ${duoTrial ? "on" : "off"}`,
    usage: "Plan limits",
    server: typeof window !== "undefined" ? window.location.host : "",
  };

  const backButton = (
    <button
      ref={backRef}
      type="button"
      onClick={closeSettings}
      aria-label="Close settings"
      className="text-muted-foreground active:bg-accent hover:bg-accent grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg"
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  );

  const layer =
    "bg-background fixed inset-0 z-[45] flex pt-[env(safe-area-inset-top)]";
  // Clear of the iOS app's system column on the right
  const rightInset = "pr-[var(--safe-right,env(safe-area-inset-right))]";

  if (narrow) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
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
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
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
