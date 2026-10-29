import { proxy } from "valtio";
import type { ColumnOrder } from "@/lib/column-spec";

/** The preference it's saved under (/api/preferences), shared by every device */
export const COLUMN_ORDER_KEY = "column-order";

/**
 * The person's own column order (Settings → Control column). Read outside
 * React too: the iOS app's column is built from it (nativeColumn).
 */
export const columnOrderStore = proxy<{ order: ColumnOrder }>({ order: {} });
