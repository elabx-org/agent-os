"use client";

import { useMemo } from "react";
import {
  otherTargets,
  useMachineSources,
  useMachines,
  useTabMachineId,
} from "@/data/machines";
import { switchMachine } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import {
  EMPTY_OTHERS,
  otherMachinesNow,
  type MachineTag,
  type OtherMachinesNow,
} from "@/lib/machine-now";

/**
 * Now's rows from the other machines (and this server's, when the tab is on
 * a machine). Empty, with no reads beyond the one machines list, while
 * nothing else is linked and online.
 */
export function useOtherMachinesNow(): OtherMachinesNow {
  const { data } = useMachines();
  const mine = useTabMachineId();
  const tags = useMemo(() => otherTargets(data, mine), [data, mine]);
  const sources = useMachineSources(tags);
  return useMemo(
    () => (sources.length ? otherMachinesNow(sources) : EMPTY_OTHERS),
    [sources]
  );
}

/** Opens a row from another machine: the tab moves there, onto it */
export function openOnMachine(
  tag: MachineTag,
  open: { session?: string; project?: string }
) {
  switchMachine(tag.target === HUB_TARGET ? null : tag.target, open);
}
