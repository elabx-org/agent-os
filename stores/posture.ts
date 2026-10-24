import { proxy } from "valtio";

/**
 * Where a half-open foldable's fold crosses the viewport, in CSS pixels from
 * the viewport's top (horizontal fold, laptop or tabletop pose) or left
 * (vertical fold, book pose). `null` when flat, closed or not a foldable.
 */
export interface Fold {
  axis: "horizontal" | "vertical";
  start: number;
  end: number;
}

export const postureStore = proxy<{ fold: Fold | null }>({ fold: null });

/** Agent-OS reads the fold from: the iOS app, Safari's Viewport Segments API, or ?fold=h */
export function setFold(fold: Fold | null) {
  const current = postureStore.fold;
  if (
    current?.axis === fold?.axis &&
    current?.start === fold?.start &&
    current?.end === fold?.end
  )
    return;
  postureStore.fold = fold;
}
