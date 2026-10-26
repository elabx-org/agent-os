"use client";

import { Fragment } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { getAllPaneIds, type PaneLayout as PaneLayoutType } from "@/lib/panes";
import { usePanes } from "@/contexts/PaneContext";
import { useSpreadPanes } from "@/components/views/SessionSpread";
import { cn } from "@/lib/utils";

interface PaneLayoutProps {
  layout: PaneLayoutType;
  renderPane: (paneId: string) => React.ReactNode;
}

function LayoutRenderer({ layout, renderPane }: PaneLayoutProps) {
  if (layout.type === "leaf") {
    return <>{renderPane(layout.paneId)}</>;
  }

  const orientation = layout.direction;

  return (
    <Group orientation={orientation} className="h-full">
      {layout.children.map((child, index) => (
        <Fragment key={child.type === "leaf" ? child.paneId : index}>
          <Panel
            defaultSize={layout.sizes[index]}
            minSize={15}
            className="h-full"
          >
            <LayoutRenderer layout={child} renderPane={renderPane} />
          </Panel>
          {index < layout.children.length - 1 && (
            <Separator
              className={` ${orientation === "horizontal" ? "w-0.5 cursor-col-resize" : "h-0.5 cursor-row-resize"} bg-border hover:bg-primary/40 active:bg-primary/60 rounded-full transition-colors`}
            />
          )}
        </Fragment>
      ))}
    </Group>
  );
}

export function PaneLayout({
  renderPane,
}: {
  renderPane: (paneId: string) => React.ReactNode;
}) {
  const { state, isMobile, focusedPaneId } = usePanes();
  const spread = useSpreadPanes();

  // On mobile: only render the focused pane (single pane mode)
  if (isMobile) {
    return <div className="h-full w-full">{renderPane(focusedPaneId)}</div>;
  }

  // The open Duo: a pane on each page, or only the focused one beside the
  // home. The others stay mounted (hidden), so no terminal attaches twice.
  if (spread) {
    const ids = getAllPaneIds(state.layout).slice(0, 2);
    const fold = spread.mode === "fold";
    return (
      <div className="flex h-full w-full">
        {ids.map((paneId, i) => {
          const shown = fold || paneId === focusedPaneId;
          return (
            <Fragment key={paneId}>
              {fold && i === 1 && (
                <div
                  aria-hidden="true"
                  className="bg-background shrink-0"
                  style={{ width: spread.gutter }}
                />
              )}
              <div
                className={cn(
                  "h-full min-w-0",
                  fold && i === 0 ? "shrink-0" : "flex-1",
                  !shown && "hidden"
                )}
                style={fold && i === 0 ? { width: spread.left } : undefined}
              >
                {renderPane(paneId)}
              </div>
            </Fragment>
          );
        })}
      </div>
    );
  }

  // On desktop: render full layout tree with splits
  return (
    <div className="h-full w-full">
      <LayoutRenderer layout={state.layout} renderPane={renderPane} />
    </div>
  );
}
