import { useCallback, useEffect, useRef, useState } from "react";

import { type ContainerLogsStream, ContainersAdapter } from "@/container-client/adapters/containers";
import { createContainerLogDecoder } from "@/container-client/logs";
import type { TerminalHandle } from "@/web-app/components/Terminal";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";

export type ContainerLogStreamStatus = "idle" | "connecting" | "live" | "ended" | "error";

export interface ContainerLogStreamState {
  error?: string;
  reload: () => void;
  setTerminal: (handle: TerminalHandle) => void;
  status: ContainerLogStreamStatus;
}

function addStreamListener(
  stream: ContainerLogsStream,
  event: "data" | "end" | "error" | "close",
  listener: (...args: any[]) => void,
  cleanup: Array<() => void>,
) {
  stream.on(event, listener);
  cleanup.push(() => {
    if (stream.off) {
      stream.off(event, listener);
    } else if (stream.removeListener) {
      stream.removeListener(event, listener);
    }
  });
}

export function useContainerLogStream(connectionId: string, containerId: string | undefined, enabled: boolean) {
  const terminal = useRef<TerminalHandle | null>(null);
  const stream = useRef<ContainerLogsStream | null>(null);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<ContainerLogStreamStatus>("idle");
  const [error, setError] = useState<string | undefined>();

  const closeStream = useCallback(() => {
    const current = stream.current;
    stream.current = null;
    current?.destroy?.();
    current?.close?.();
  }, []);

  const setTerminal = useCallback((handle: TerminalHandle) => {
    terminal.current = handle;
  }, []);

  const reload = useCallback(() => {
    terminal.current?.clear();
    closeStream();
    setGeneration((it) => it + 1);
  }, [closeStream]);

  useEffect(() => {
    if (!enabled || !connectionId || !containerId) {
      closeStream();
      setStatus("idle");
      return;
    }
    const reloadGeneration = generation;
    let cancelled = false;
    const cleanup: Array<() => void> = [];
    const decoder = createContainerLogDecoder();
    setStatus("connecting");
    setError(undefined);

    void reloadGeneration;
    // Bind the adapter to THIS connection's host (mirrors queries.ts / bulkActions.ts). Without it the
    // adapter falls back to the global "current" host — undefined in the always-merged workspace — and the
    // stream crashes with "Cannot read properties of undefined (reading 'getApiDriver')".
    resolveConnectionHost(connectionId)
      .then((host) => new ContainersAdapter(host).logsStream(containerId, { tail: 200 }))
      .then((nextStream) => {
        if (cancelled) {
          nextStream.destroy?.();
          nextStream.close?.();
          return;
        }
        stream.current = nextStream;
        setStatus("live");
        addStreamListener(
          nextStream,
          "data",
          (chunk) => {
            const decoded = decoder.push(chunk);
            if (decoded) {
              terminal.current?.write(decoded);
            }
          },
          cleanup,
        );
        addStreamListener(
          nextStream,
          "end",
          () => {
            setStatus("ended");
          },
          cleanup,
        );
        addStreamListener(
          nextStream,
          "close",
          () => {
            setStatus((current) => (current === "error" ? current : "ended"));
          },
          cleanup,
        );
        addStreamListener(
          nextStream,
          "error",
          (streamError) => {
            setStatus("error");
            setError(streamError instanceof Error ? streamError.message : `${streamError}`);
          },
          cleanup,
        );
      })
      .catch((streamError) => {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError(streamError instanceof Error ? streamError.message : `${streamError}`);
      });

    return () => {
      cancelled = true;
      for (const fn of cleanup) {
        fn();
      }
      closeStream();
    };
  }, [closeStream, connectionId, containerId, enabled, generation]);

  return { error, reload, setTerminal, status } satisfies ContainerLogStreamState;
}
