import { useEffect, useRef } from "react";

import Environment from "@/web-app/Environment";

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
  useEffect(() => {
    pollerCallback.current = poller;
  }, [poller]);
  // Clears old interval if rate changes, allowing new poller to be created
  useEffect(() => {
    console.debug("Rate changed, clearing interval", rate);
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
    let isPollingEnabled = Environment.features.polling?.enabled;
    const poller = async () => {
      try {
        if (isPending.current) {
          console.debug("Polling cycle skipped");
        } else {
          // console.debug("Polling cycle started");
          await poll();
        }
      } catch (error: any) {
        console.error("Polling cycle error, stopping - error must be handled", error);
        clearInterval(pollerID.current);
      } finally {
        isPending.current = false;
        // console.debug("Poller cycle complete");
      }
    };
    if (isPollingEnabled) {
      console.debug("Polling enabled - creating interval");
      clearInterval(pollerID.current);
      pollerID.current = setInterval(poller, frequency);
    } else {
      console.debug("Polling disabled - fetching once");
      clearInterval(pollerID.current);
      pollerID.current = setInterval(() => {
        isPollingEnabled = Environment.features.polling?.enabled;
        // console.debug("Polling flag monitoring", isPollingEnabled);
        if (isPollingEnabled) {
          clearInterval(pollerID.current);
          pollerID.current = setInterval(poller, frequency);
        }
      }, 5000);
    }
    return () => {
      clearInterval(pollerID.current);
      isPending.current = false;
      pollerCallback.current = undefined;
    };
  }, [rate]);
  useEffect(() => {
    console.debug("Poller effect created", { rate, poller });
    if (pollerCallback.current) {
      isPending.current = true;
      // console.debug("Polling initial");
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
