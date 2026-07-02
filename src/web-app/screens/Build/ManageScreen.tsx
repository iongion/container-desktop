import { Button, Divider, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pane, SplitPane } from "react-split-pane";

import { lint } from "@/container-client/build/containerfile/lint";
import { parse } from "@/container-client/build/containerfile/parse";
import type { BuildEngineKind, ImageBuildOptions } from "@/container-client/build/types";
import { ContainerEngine } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { ConnectionSelect, connectedConnections } from "@/web-app/components/ConnectionSelect";
import { useRouteSearch } from "@/web-app/Navigator";
import { useImageHistory } from "@/web-app/screens/Image/queries";
import { useAppStore } from "@/web-app/stores/appStore";
import { useBuildStore } from "@/web-app/stores/buildStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { BuildConfigPanel } from "./BuildConfigPanel";
import { BuildRunPanel } from "./BuildRunPanel";
import { ContainerfileEditorPane } from "./ContainerfileEditorPane";
import { LayerInspector } from "./LayerInspector";
import { BUILD_ID, BUILD_ROUTE, getBuildCrumbs, isBuildSupported } from "./Navigation";
import { useStartBuild } from "./useBuildStreaming";

import "./Build.css";

export const ID = BUILD_ID;
export interface ScreenProps extends AppScreenProps {}

const DEFAULT_CONTAINERFILE = `# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "server.js"]
`;

function engineKindOf(engine: ContainerEngine): BuildEngineKind {
  if (engine === ContainerEngine.PODMAN) {
    return "podman";
  }
  if (engine === ContainerEngine.APPLE) {
    return "apple";
  }
  return "docker";
}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { connId: connIdParam } = useRouteSearch<{ connId?: string }>();
  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  // v1 builds run on native connections only; the picker + the CTA on Images are both gated on this set.
  const nativeConnections = useMemo(
    () => connectedConnections(connections, activeRuntime, isBuildSupported),
    [connections, activeRuntime],
  );
  const [selectedConnId, setSelectedConnId] = useState(connIdParam ?? "");
  // Default to a non-Apple native host — the Apple engine is experimental, so it shouldn't be auto-selected
  // when a Podman/Docker connection is available. An explicit connId (deep link) or the user's picker choice
  // still wins; this only steers the zero-config default.
  const preferredDefault =
    nativeConnections.find((connection) => connection.engine !== ContainerEngine.APPLE) ?? nativeConnections[0];
  const connectionId = nativeConnections.some((connection) => connection.id === selectedConnId)
    ? selectedConnId
    : (nativeConnections.find((connection) => connection.id === connIdParam)?.id ?? preferredDefault?.id ?? "");
  const connection = nativeConnections.find((entry) => entry.id === connectionId);
  const engine: BuildEngineKind = connection ? engineKindOf(connection.engine) : "docker";

  // The authored Containerfile buffer (edited by the editor pane) and the latest effective build options from
  // the config panel. The options live in a ref — they change on every keystroke and only the build handler
  // reads them, so there is no need to re-render the screen for each edit.
  const [content, setContent] = useState(DEFAULT_CONTAINERFILE);
  const buildOptionsRef = useRef<ImageBuildOptions | null>(null);
  const handleOptionsChange = useCallback((next: ImageBuildOptions) => {
    buildOptionsRef.current = next;
  }, []);
  const ast = useMemo(() => parse(content), [content]);
  const findings = useMemo(() => lint(ast), [ast]);

  const { start, cancel } = useStartBuild();
  const activeRun = useBuildStore((state) => (state.activeRunId ? state.runs[state.activeRunId] : undefined));
  const building = activeRun?.status === "running";
  // Layers tab of the run panel: the built image's history. buildx --progress=rawjson does NOT report the image
  // id in its logs (it's buried in an exporter status, and which digest is "the id" varies by image store), so
  // on a SUCCESSFUL build we reference the image by the tag it was --loaded under — reliable across engines —
  // falling back to a parsed image id if one is ever captured.
  const builtImageRef = activeRun?.status === "succeeded" ? (activeRun.imageId ?? activeRun.tags?.[0]) : undefined;
  const builtHistory = useImageHistory(activeRun?.connectionId ?? connectionId, builtImageRef);
  const layersNode = builtImageRef && builtHistory.data ? <LayerInspector history={builtHistory.data} /> : undefined;

  const onBuild = useCallback(() => {
    const base = buildOptionsRef.current;
    if (!base || !content.trim()) {
      return;
    }
    void start({ ...base, containerfileContent: content });
  }, [content, start]);

  // No native buildable engine connected → the gated "coming soon" state.
  if (nativeConnections.length === 0) {
    return (
      <div className="AppScreen" data-screen={ID}>
        <AppScreenHeader withoutSearch withBack breadcrumbs={getBuildCrumbs()} titleIcon={IconNames.BUILD} />
        <div className="AppScreenContent" data-loaded="no">
          <NonIdealState
            icon={IconNames.BUILD}
            title={t("Building images needs a native engine")}
            description={
              <p>{t("Connect a native Podman, Docker or Apple engine. WSL / Lima / SSH builds come next.")}</p>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        breadcrumbs={getBuildCrumbs(connectionId)}
        rightContent={
          <>
            <ConnectionSelect
              inline
              value={connectionId}
              onChange={setSelectedConnId}
              filter={isBuildSupported}
              label={t("Build on")}
            />
            <Divider />
            {building ? (
              <Button
                className="BuildActionButton"
                intent={Intent.DANGER}
                icon={IconNames.STOP}
                text={t("Cancel")}
                onClick={cancel}
              />
            ) : (
              <Button
                className="BuildActionButton"
                intent={Intent.PRIMARY}
                icon={IconNames.BUILD}
                text={t("Build image")}
                disabled={!connectionId || !content.trim()}
                onClick={onBuild}
              />
            )}
          </>
        }
      />
      <div className="BuildStudio">
        {/* Resizable layout: left column (Containerfile over Build run) | Build configuration rail. Sizes are
            percentages with px minimums so panels never collapse below a usable size. */}
        <SplitPane direction="horizontal" className="studio" dividerSize={8}>
          <Pane defaultSize="70%" minSize="360px">
            <SplitPane direction="vertical" dividerSize={8}>
              <Pane defaultSize="58%" minSize="160px">
                <ContainerfileEditorPane engine={engine} value={content} onChange={setContent} findings={findings} />
              </Pane>
              <Pane minSize="180px">
                <BuildRunPanel run={activeRun} ast={ast} layers={layersNode} />
              </Pane>
            </SplitPane>
          </Pane>
          <Pane defaultSize="30%" minSize="320px">
            <BuildConfigPanel
              engine={engine}
              connectionId={connectionId}
              containerfileContent={content}
              onOptionsChange={handleOptionsChange}
            />
          </Pane>
        </SplitPane>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Build";
Screen.Route = {
  Path: BUILD_ROUTE,
};
Screen.Metadata = {
  ExcludeFromSidebar: true,
  LeftIcon: IconNames.BUILD,
};
