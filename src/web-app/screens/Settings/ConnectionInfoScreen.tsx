import { Button, H5, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { isEmpty } from "lodash-es";
import { useCallback } from "react";

import { t } from "@/web-app/App.i18n";
import { Notification } from "@/web-app/Notification";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { useStoreState } from "@/web-app/domain/types";
import { ScreenHeader } from "./ScreenHeader";

import { OperatingSystem } from "@/env/Types";
import "./ConnectionInfoScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "settings.connection-info";
export const View = "connection-info";
export const Title = "Connection info";

const scopedCodeExample = `
// 1. From a %OPERATING_SYSTEM% terminal console:
//
// %ENV_EXPORT%="%HOST_DOCKER_HOST%"
// node example.mjs
// %CLI% ps

// 2. From a %LABEL% terminal console inside %SCOPE%:
//
// export DOCKER_HOST="%SCOPE_DOCKER_HOST%"
// node example.mjs
// %CLI% ps
`;

const codeExample = `// This code example demonstrates how to connect to the container engine from nodejs
// Save it in a file named example.mjs and run it with the following command

import axios from "axios"; // npm install axios
import httpAdapter from "axios/lib/adapters/http.js";
import http from "node:http";

const driver = axios.create({
  adapter: httpAdapter,
  httpAgent: new http.Agent(),
  baseURL: "http://localhost",
  socketPath: process.env.DOCKER_HOST
});
const response = await driver.get("/_ping");
console.debug(response.data);
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
  const currentConnector = useStoreState((state) => state.currentConnector);
  const osType = useStoreState((state) => state.osType);
  const isScoped = !isEmpty(currentConnector?.settings.controller?.scope || "");
  const source = (isScoped ? `${codeExample}${scopedCodeExample}` : `${codeExample}`)
    // Host
    .replaceAll("%HOST_DOCKER_HOST%", normalizeConnectionString(currentConnector?.settings?.api?.connection?.uri || ""))
    // Scope
    .replaceAll("%SCOPE_DOCKER_HOST%", currentConnector?.settings?.api?.connection?.relay || "")
    // Scope
    .replaceAll("%BASE_URL%", JSON.stringify(currentConnector?.settings?.api?.baseURL || "http://localhost"))
    // Environment
    .replaceAll("%ENV_EXPORT%", osType === OperatingSystem.Windows ? "$env:DOCKER_HOST" : "export DOCKER_HOST")
    // Extras
    .replaceAll("%OPERATING_SYSTEM%", osType === OperatingSystem.Windows ? "Windows" : osType)
    .replaceAll("%CLI%", currentConnector?.settings.program?.name || "")
    .replaceAll("%LABEL%", currentConnector?.label || "")
    .replaceAll("%SCOPE%", currentConnector?.settings.controller?.scope || "");

  const onCopyToClipboardClick = useCallback(async (e) => {
    const contentNode = e.currentTarget?.parentNode.closest("tr").querySelector("td:nth-child(2)");
    await navigator.clipboard.writeText((contentNode?.innerText || "").trim());
    Notification.show({
      message: t("The value was copied to clipboard"),
      intent: Intent.SUCCESS,
    });
  }, []);

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} titleText={currentConnector?.name || ""} />
      <div className="AppScreenContent">
        <HTMLTable compact striped interactive className="AppDataTable" data-table="settings.connection-info">
          <thead>
            <tr>
              <th data-column="Property">{t("Property")}</th>
              <th data-column="Value">{t("Value")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>{t("ID")}</code>
              </td>
              <td>
                <Button small minimal icon={IconNames.CLIPBOARD} onClick={onCopyToClipboardClick} />
                &nbsp;
                {currentConnector?.id}
              </td>
              <td></td>
            </tr>
            <tr>
              <td>
                <code>{t("Name")}</code>
              </td>
              <td>
                <Button small minimal icon={IconNames.CLIPBOARD} onClick={onCopyToClipboardClick} />
                &nbsp;
                {currentConnector?.name}
              </td>
              <td></td>
            </tr>
            <tr>
              <td>
                <code>{t("Label")}</code>
              </td>
              <td>
                <Button small minimal icon={IconNames.CLIPBOARD} onClick={onCopyToClipboardClick} />
                &nbsp;
                {currentConnector?.label}
              </td>
              <td></td>
            </tr>
            {isScoped ? (
              <tr>
                <td>
                  <code>{t("Guest")}</code>
                </td>
                <td>
                  <Button small minimal icon={IconNames.CLIPBOARD} onClick={onCopyToClipboardClick} />
                  &nbsp;
                  {currentConnector?.settings?.controller?.scope || ""}
                </td>
                <td></td>
              </tr>
            ) : null}
            <tr>
              <td>
                <code>{t("DOCKER_HOST")}</code>
              </td>
              <td>
                <Button small minimal icon={IconNames.CLIPBOARD} onClick={onCopyToClipboardClick} />
                &nbsp;
                {normalizeConnectionString(currentConnector?.settings?.api?.connection?.uri || "")}
              </td>
              <td></td>
            </tr>
            <tr>
              <td>
                <code>{t("DOCKER_HOST - guest")}</code>
              </td>
              <td>
                <Button small minimal icon={IconNames.CLIPBOARD} onClick={onCopyToClipboardClick} />
                &nbsp;
                {normalizeConnectionString(currentConnector?.settings?.api?.connection?.relay || "")}
              </td>
              <td></td>
            </tr>
          </tbody>
        </HTMLTable>
        <H5>{t("Connection code example")}</H5>
        <div className="CodeEditor ConnectionCodeEditor">
          <CodeEditor mode="javascript" value={source} />
        </div>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/settings/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
