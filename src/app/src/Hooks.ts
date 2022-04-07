import { useEffect, useLayoutEffect, useRef } from "react";
// project
import Environment from "./Environment";

type Poller<T> = () => Promise<T>;

interface UsePollerProps<T> {
  poller: Poller<T>;
  rate?: number | null;
  continueOnError?: boolean;
}

export const usePoller = <T>({ poller, rate }: UsePollerProps<T>) => {
  const pollerCallback = useRef<Poller<T>>();
  const pollerID = useRef<any>();
  const isPending = useRef<boolean>(false);
  // Allows interval to continue if poller changes over time
  useLayoutEffect(() => {
    pollerCallback.current = poller;
  }, [poller]);
  // Clears old interval if rate changes, allowing new poller to be created
  useLayoutEffect(() => {
    clearInterval(pollerID.current);
  }, [rate]);
  // Poller effect
  useEffect(() => {
    const frequency = rate === undefined ? Environment.settings.poll.rate : null;
    // Guard against previous interval
    clearInterval(pollerID.current);
    if (frequency === null) {
      console.warn("Stopped on rate cleanup");
      return;
    }
    isPending.current = false;
    function poll() {
      if (pollerCallback.current) {
        if (isPending.current) {
          // console.warn("Skip poll cycle - still pending");
          return;
        }
        isPending.current = true;
        return pollerCallback.current();
      }
    }
    pollerID.current = setInterval(async () => {
      try {
        // console.debug("Polling cycle started");
        await poll();
      } catch (error) {
        console.error("Polling cycle error, stopping - error must be handled", error);
        clearInterval(pollerID.current);
      } finally {
        isPending.current = false;
        // console.debug("Poller cycle complete");
        if (!Environment.features.polling?.enabled) {
          console.debug("Polling disabled - stopping after first cycle", Environment.features);
          clearInterval(pollerID.current);
        }
      }
    }, frequency);
    return () => {
      clearInterval(pollerID.current);
      isPending.current = false;
      pollerCallback.current = undefined;
    };
  }, [rate]);
  useEffect(() => {
    if (pollerCallback.current) {
      isPending.current = true;
      pollerCallback.current().finally(() => {
        isPending.current = false;
      });
    }
    return () => {
      clearInterval(pollerID.current);
      isPending.current = false;
      pollerCallback.current = undefined;
    };
  }, [rate, poller]);
};
