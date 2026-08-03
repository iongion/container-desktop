import { H5 } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useState } from "react";
import { resolveTransport } from "@/container-client/reachability/model";
import { OperatingSystem } from "@/container-client/types/os";
import i18n, { t } from "@/i18n";
import { isEmpty } from "@/utils";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { PropertyValueTable, type PropertyValueTableRow } from "@/web-app/components/PropertyValueTable";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ConnectionDetailsActionsMenu } from "./ActionsMenu";
import { ConnectionDetailLayout } from "./ConnectionDetailRail";
import { getConnectionCrumbs, getConnectionsUrl } from "./Navigation";
import "./ConnectionInfoScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "connections.connection-info";
export const View = "connection-info";
export const Title = i18n.t("Connection info");

const scopedCodeExample = `
/*
Save the content above in a file named example.mjs, then:

1. From a %OPERATING_SYSTEM% terminal console:

%ENV_EXPORT%="%HOST_DOCKER_HOST%"
node example.mjs
%CLI% ps

2. From a %LABEL% terminal console inside %SCOPE%:

export DOCKER_HOST="%SCOPE_DOCKER_HOST%"
node example.mjs
%CLI% ps
*/
`;

const codeExample = `// This code example demonstrates how to connect to the container engine from nodejs
import axios from "axios"; // npm install axios
import httpAdapter from "axios/lib/adapters/http.js";
import http from "node:http";
import { createLogger } from "@/logger";

const logger = createLogger("web.connections");

const driver = axios.create({
  adapter: httpAdapter,
  httpAgent: new http.Agent(),
  baseURL: "http://localhost",
  socketPath: process.env.DOCKER_HOST
});
const response = await driver.get("/_ping");
logger.debug(response.data);
`;

function normalizeConnectionString(host: string) {
  if (host.includes(".\\pipe")) {
    return `npipe://${host.replaceAll("\\", "/")}`;
  }
  if (!host.includes("unix:")) {
    return `unix://${host}`;
  }
  return host;
}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = decodeURIComponent(id || "");
  const connections = useAppStore((state) => state.connections);
  const refreshConnections = useAppStore((state) => state.getConnections);
  const osType = useAppStore((state) => state.osType);
  const selected = connections.find((item) => item.id === connectionId);
  const title = selected?.name || connectionId;
  const onReload = useCallback(() => {
    void refreshConnections();
  }, [refreshConnections]);
  const isScoped = !isEmpty(selected?.settings.controller?.scope || "");
  const isAutomatic = selected?.settings?.mode === "mode.automatic";
  // Native = a local unix socket / named pipe (no VM / SSH / WSL / Lima guest hop); only remote transports
  // have a meaningful in-guest "DOCKER_HOST - guest".
  const isNative = resolveTransport(selected?.host) === "native";
  // Resolved socket coordinates. The CONFIGURED connection.uri/relay are intentionally empty for automatic
  // connections (resolved per-OS on connect), which is why DOCKER_HOST showed a bare "unix://". Prefer the
  // connected runtime snapshot (main writes the real uri/relay there on connect), then a one-shot discovery
  // for automatic connections viewed before a live runtime exists, then the configured settings.
  const runtime = useResourceStore((state) => state.activeRuntime).find((item) => item.id === connectionId);
  const [discovered, setDiscovered] = useState<{ uri: string; relay: string } | null>(null);
  useEffect(() => {
    // Reset per connection, then run a one-shot discovery only when needed: an automatic connection whose
    // runtime snapshot carries no resolved uri yet. Best-effort — failures keep the configured/empty fallback.
    setDiscovered(null);
    if (!isAutomatic || runtime?.uri) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const host = await resolveConnectionHost(connectionId);
        const api = await host?.getApiConnection();
        if (!cancelled && api) {
          setDiscovered({ uri: api.uri || "", relay: api.relay || "" });
        }
      } catch {
        // ignore — keep the configured/empty fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, isAutomatic, runtime?.uri]);
  const hostDockerHost = normalizeConnectionString(
    runtime?.uri || discovered?.uri || selected?.settings?.api?.connection?.uri || "",
  );
  const guestDockerHost = normalizeConnectionString(
    runtime?.relay || discovered?.relay || selected?.settings?.api?.connection?.relay || "",
  );
  const rows: PropertyValueTableRow[] = [
    { key: "id", label: t("ID"), value: selected?.id || "" },
    { key: "name", label: t("Name"), value: selected?.name || "" },
    { key: "label", label: t("Label"), value: selected?.label || "" },
    ...(isScoped ? [{ key: "guest", label: t("Guest"), value: selected?.settings?.controller?.scope || "" }] : []),
    { key: "docker-host", label: t("DOCKER_HOST"), value: hostDockerHost },
    // Native connections have no guest side — omit the meaningless "DOCKER_HOST - guest" row.
    ...(isNative ? [] : [{ key: "docker-host-guest", label: t("DOCKER_HOST - guest"), value: guestDockerHost }]),
  ];
  const source = (isScoped ? `${codeExample}${scopedCodeExample}` : `${codeExample}`)
    // Host
    .replaceAll("%HOST_DOCKER_HOST%", hostDockerHost)
    // Scope
    .replaceAll("%SCOPE_DOCKER_HOST%", guestDockerHost)
    // Scope
    .replaceAll("%BASE_URL%", JSON.stringify(selected?.settings?.api?.baseURL || "http://localhost"))
    // Environment
    .replaceAll("%ENV_EXPORT%", osType === OperatingSystem.Windows ? "$env:DOCKER_HOST" : "export DOCKER_HOST")
    // Extras
    .replaceAll("%OPERATING_SYSTEM%", osType === OperatingSystem.Windows ? "Windows" : osType)
    .replaceAll("%CLI%", selected?.settings.program?.name || "")
    .replaceAll("%LABEL%", selected?.label || "")
    .replaceAll("%SCOPE%", selected?.settings.controller?.scope || "");

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        listRoutePath={getConnectionsUrl("manage")}
        listRouteIcon={IconNames.DATA_CONNECTION}
        titleIcon={IconNames.DATA_CONNECTION}
        titleText={title}
        breadcrumbs={getConnectionCrumbs(title, View, connectionId)}
        rightContent={
          <ConnectionDetailsActionsMenu connectionId={connectionId} currentScreen={ID} onReload={onReload} />
        }
      />
      <ConnectionDetailLayout connectionId={connectionId} currentScreen={ID}>
        <PropertyValueTable rows={rows} dataTable="connections.connection-info" />
        <H5>{t("Connection code example")}</H5>
        <div className="CodeEditor ConnectionCodeEditor">
          <CodeEditor mode="javascript" value={source} />
        </div>
      </ConnectionDetailLayout>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/connections/$id/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
