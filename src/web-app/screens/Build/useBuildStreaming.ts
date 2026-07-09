// Streaming build wiring for the renderer. `createBuildSink` pipes BuildAdapter events into the buildStore
// (pure factory over the store actions — testable). `useStartBuild` creates a run, resolves the connection's
// host, starts the streamed build, and on success nudges the images list to refresh. The BuildHandle is held
// in a ref so the run panel can cancel it and effects can dispose it.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import { BuildAdapter, type BuildHandle } from "@/container-client/adapters/build";
import type { BuildRun, BuildSink, ImageBuildOptions } from "@/container-client/builder/types";
import { randomUUID } from "@/utils/randomUUID";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { imageKeys } from "@/web-app/screens/Image/queries";
import { useBuildStore } from "@/web-app/stores/buildStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

import { buildRedactedPreview } from "./BuildConfigPanel.logic";

function errorText(error: unknown): string {
  return `${(error as { message?: string })?.message ?? error}`;
}

// Pipe a running build's events into the buildStore. Not a hook — safe to unit test directly.
export function createBuildSink(runId: string, onDone?: (code: number | null) => void): BuildSink {
  const store = useBuildStore.getState;
  return {
    onStep: (step) => store().upsertStep(runId, step),
    onLog: (key, line) => store().appendLog(runId, key, line),
    onImageId: (imageId) => store().setImageId(runId, imageId),
    onError: (error) => store().finishRun(runId, null, { errorSummary: errorText(error) }),
    onDone: (code) => {
      store().finishRun(runId, code);
      onDone?.(code);
    },
  };
}

export function useStartBuild() {
  const qc = useQueryClient();
  const handleRef = useRef<BuildHandle | null>(null);

  const start = useCallback(
    async (options: ImageBuildOptions): Promise<string> => {
      const runId = randomUUID();
      const run: BuildRun = {
        id: runId,
        connectionId: options.connectionId,
        engine: options.engine,
        options,
        argvPreview: buildRedactedPreview(options),
        status: "running",
        startedAt: Date.now(),
        steps: [],
        tags: options.tags,
      };
      useBuildStore.getState().startRun(run);
      try {
        const host = await resolveConnectionHost(options.connectionId);
        const sink = createBuildSink(runId, (code) => {
          if (code === 0) {
            resourceEvents.refresh(options.connectionId, "images");
            qc.invalidateQueries({ queryKey: imageKeys.list(options.connectionId) });
          }
        });
        handleRef.current = await new BuildAdapter(host).start(options, sink);
      } catch (error) {
        useBuildStore.getState().finishRun(runId, null, { errorSummary: errorText(error) });
      }
      return runId;
    },
    [qc],
  );

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
  }, []);

  return { start, cancel };
}
