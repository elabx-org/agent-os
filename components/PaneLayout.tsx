"use client";

import { Fragment, type ReactNode } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { useSnapshot } from "valtio";
import { getAllPaneIds, type PaneLayout as PaneLayoutType } from "@/lib/panes";
import { usePanes } from "@/contexts/PaneContext";
import { useSpreadPanes } from "@/components/views/SessionSpread";
import {
  GUTTER_ORDER,
  paneCssOrder,
  paneOrder,
  paneOrderStore,
} from "@/stores/paneOrder";
import { cn } from "@/lib/utils";

interface PaneLayoutProps {
  layout: PaneLayoutType;
  renderPane: (paneId: string) => ReactNode;
  /** Each pane a card with gaps between (Desk-Beside) */
  cards?: boolean;
}

function LayoutRenderer({ layout, renderPane, cards }: PaneLayoutProps) {
  if (layout.type === "leaf") {
    return (
      <div
        className={cn(
          "h-full w-full",
          cards &&
            "bg-card overflow-hidden rounded-[18px] border border-[var(--hair)] dark:bg-[#050506]"
        )}
      >
        {renderPane(layout.paneId)}
      </div>
    );
  }

  const orientation = layout.direction;
  const horizontal = orientation === "horizontal";

  return (
    <Group orientation={orientation} className="h-full">
      {layout.children.map((child, index) => (
        <Fragment key={child.type === "leaf" ? child.paneId : index}>
          <Panel
            defaultSize={layout.sizes[index]}
            minSize={15}
            className="h-full"
          >
            <LayoutRenderer
              layout={child}
              renderPane={renderPane}
              cards={cards}
            />
          </Panel>
          {index < layout.children.length - 1 && (
            <Separator
              className={cn(
                horizontal ? "cursor-col-resize" : "cursor-row-resize",
                // Cards: the gap between them is the handle
                cards
                  ? cn(
                      horizontal ? "w-3" : "h-3",
                      "hover:bg-primary/20 active:bg-primary/30 rounded-full bg-transparent transition-colors"
                    )
                  : cn(
                      horizontal ? "w-0.5" : "h-0.5",
                      "bg-border hover:bg-primary/40 active:bg-primary/60 rounded-full transition-colors"
                    )
              )}
            />
          )}
        </Fragment>
      ))}
    </Group>
  );
}

export function PaneLayout({
  renderPane,
  paneTop,
  cards,
}: {
  renderPane: (paneId: string) => ReactNode;
  /**
   * Above each pane while two share the open Duo's pages: its session pill
   * (Open-Beside)
   */
  paneTop?: (paneId: string) => ReactNode;
  /** Desktop with two or more: each pane a card (Desk-Beside) */
  cards?: boolean;
}) {
  const { state, isMobile, focusedPaneId } = usePanes();
  const spread = useSpreadPanes();
  const { swapped } = useSnapshot(paneOrderStore);

  // On mobile: only render the focused pane (single pane mode)
  if (isMobile) {
    return <div className="h-full w-full">{renderPane(focusedPaneId)}</div>;
  }

  // The open Duo: a pane on each page, or only the focused one beside the
  // home. The others stay mounted (hidden), so no terminal attaches twice.
  // Swapping sides moves them with CSS order alone, never in the tree.
  if (spread) {
    const ids = getAllPaneIds(state.layout).slice(0, 2);
    const fold = spread.mode === "fold";
    const leftId = paneOrder(ids, swapped)[0];
    return (
      <div className="flex h-full w-full">
        {ids.map((paneId) => {
          const shown = fold || paneId === focusedPaneId;
          const left = fold && paneId === leftId;
          return (
            <div
              key={paneId}
              data-pane-id={paneId}
              className={cn(
                "flex h-full min-w-0 flex-col",
                left ? "shrink-0" : "flex-1",
                !shown && "hidden"
              )}
              style={
                fold
                  ? {
                      order: paneCssOrder(paneId, ids, swapped),
                      width: left ? spread.left : undefined,
                    }
                  : undefined
              }
            >
              {fold && paneTop && (
                <div className="flex shrink-0 px-5 pt-4 pb-2">
                  {paneTop(paneId)}
                </div>
              )}
              <div className="min-h-0 flex-1">{renderPane(paneId)}</div>
            </div>
          );
        })}
        {fold && (
          <div
            aria-hidden="true"
            className="bg-background shrink-0"
            style={{ width: spread.gutter, order: GUTTER_ORDER }}
          />
        )}
      </div>
    );
  }

  // On desktop: render full layout tree with splits
  return (
    <div className={cn("h-full w-full", cards && "p-3")}>
      <LayoutRenderer
        layout={state.layout}
        renderPane={renderPane}
        cards={cards}
      />
    </div>
  );
}
