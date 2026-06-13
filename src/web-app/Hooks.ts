import { useEffect, useRef } from "react";

import Environment from "@/web-app/Environment";

type Poller<T> = () => Promise<T>;

interface UsePollerProps<T> {
  poller: Poller<T>;
  rate?: number | null;
  continueOnError?: boolean;
}

export const usePoller = <T>({ poller, rate }: UsePollerProps<T>) => {
  const pollerCallback = useRef<Poller<T>>(undefined);
  const pollerID = useRef<any>(undefined);
  const isPending = useRef<boolean>(false);
  // Allows interval to continue if poller changes over time
  useEffect(() => {
    pollerCallback.current = poller;
  }, [poller]);
  // Poller effect (also clears any previous interval up-front, so a separate
  // rate-change cleanup effect is unnecessary).
  useEffect(() => {
    const frequency = rate === undefined ? Environment.settings.poll.rate : null;
    // Guard against previous interval
    if (pollerID.current) {
      clearInterval(pollerID.current);
    }
    if (frequency === null) {
      return;
    }
    isPending.current = false;
    async function poll() {
      if (pollerCallback.current) {
        if (isPending.current) {
          // console.warn("Skip poll cycle - still pending");
          return;
        }
        isPending.current = true;
        return pollerCallback.current();
      }
    }
    const isPollingEnabled = Environment.features.polling?.enabled;
    const poller = async () => {
      try {
        if (!isPending.current) {
          await poll();
        }
      } catch (error: any) {
        console.error("Polling cycle error, stopping - error must be handled", error);
        if (pollerID.current) {
          clearInterval(pollerID.current);
        }
      } finally {
        isPending.current = false;
        // console.debug("Poller cycle complete");
      }
    };
    // Only run a recurring interval when polling is enabled. When disabled (the dev
    // default) the one-shot fetch in the effect below still runs once; avoid spinning
    // a permanent monitor interval that churns forever.
    if (isPollingEnabled) {
      pollerID.current = setInterval(poller, frequency);
    }
    return () => {
      if (pollerID.current) {
        clearInterval(pollerID.current);
      }
      isPending.current = false;
      pollerCallback.current = undefined;
    };
  }, [rate]);
  // Fetch once immediately whenever the poller changes (e.g. new screen / filter),
  // independent of the recurring interval set up above (which handles the `rate`).
  useEffect(() => {
    isPending.current = true;
    poller().finally(() => {
      isPending.current = false;
    });
    return () => {
      isPending.current = false;
    };
  }, [poller]);
};
