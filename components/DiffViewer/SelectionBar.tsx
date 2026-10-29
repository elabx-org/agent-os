"use client";

export interface SelectionBarProps {
  /** "2 lines" */
  lines: number;
  onComment: () => void;
  onClear: () => void;
  className?: string;
}

/**
 * The floating bar over a selection: "2 lines · Comment" (D-Diff), with the
 * C shortcut on the desktop. M12 contract stub: U12.2 implements
 */
export function SelectionBar(props: SelectionBarProps) {
  void props;
  return null;
}
