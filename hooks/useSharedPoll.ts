import { useEffect } from "react";
import { hashKey, useQueryClient, type QueryKey } from "@tanstack/react-query";

const polls = new Map<string, { count: number; timer: number }>();

/**
 * Refetches a query every `ms` while any caller wants it, on one timer per
 * key. react-query's refetchInterval runs a timer per observer, so two
 * components showing the same data would double the requests.
 */
export function useSharedPoll(queryKey: QueryKey, ms: number, enabled = true) {
  const queryClient = useQueryClient();
  const hash = hashKey(queryKey);
  useEffect(() => {
    if (!enabled) return;
    const key = `${hash}@${ms}`;
    let poll = polls.get(key);
    if (!poll) {
      const queryKey = JSON.parse(hash) as QueryKey;
      poll = {
        count: 0,
        timer: window.setInterval(() => {
          // Like refetchInterval: not while the tab is in the background
          if (document.visibilityState !== "visible") return;
          queryClient.refetchQueries(
            { queryKey, exact: true },
            { cancelRefetch: false }
          );
        }, ms),
      };
      polls.set(key, poll);
    }
    const shared = poll;
    shared.count++;
    return () => {
      if (--shared.count > 0) return;
      window.clearInterval(shared.timer);
      polls.delete(key);
    };
  }, [hash, ms, enabled, queryClient]);
}
