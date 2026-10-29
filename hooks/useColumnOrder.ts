"use client";

import { useCallback, useEffect } from "react";
import { useSnapshot } from "valtio";
import { usePreference, useUpdatePreference } from "@/data/preferences";
import { COLUMN_ORDER_KEY, columnOrderStore } from "@/stores/columnOrder";
import type { ColumnOrder } from "@/lib/column-spec";

const NONE: ColumnOrder = {};

/** Loads the saved order into columnOrderStore. Mounted once (app/page.tsx) */
export function useColumnOrderSource(): void {
  const { data } = usePreference<ColumnOrder>(COLUMN_ORDER_KEY, NONE);
  useEffect(() => {
    if (data) columnOrderStore.order = data;
  }, [data]);
}

/** The saved order and a setter that saves it for every device */
export function useColumnOrder(): {
  order: ColumnOrder;
  save: (order: ColumnOrder) => void;
} {
  const { order } = useSnapshot(columnOrderStore);
  const update = useUpdatePreference();
  const save = useCallback(
    (next: ColumnOrder) => {
      columnOrderStore.order = next;
      update.mutate({ key: COLUMN_ORDER_KEY, value: next });
    },
    [update]
  );
  return { order: order as ColumnOrder, save };
}
