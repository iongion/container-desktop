import { HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/web-app/components/CopyButton";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { getVolumesUrl } from "@/web-app/screens/Volume/Navigation";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./InspectScreen.css";
import i18n from "@/i18n";
import { useContainer } from "./queries";

interface InspectGroupValues {
  key: string;
  value: string;
}
interface InspectGroup {
  name: string;
  title: string;
  href?: string;
  items: InspectGroupValues[];
}

export const ID = "container.inspect";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId);
  const { data: container, refetch } = containerQuery;
  const pending = containerQuery.isLoading || containerQuery.isFetching;
  const onScreenReload = useCallback(() => {
    refetch();
  }, [refetch]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const config = container.Config || { Env: [] };
  const environmentVariables = (config.Env || []).sort(sortAlphaNum).map<InspectGroupValues>((env) => {
    const [key, value] = env.split("=");
    return {
      key,
      value,
    };
  });
  const volumeMounts: InspectGroupValues[] = container.Mounts.map((mount) => {
    return {
      key: mount.Source,
      value: mount.Destination,
    };
  });
  const containerPorts: InspectGroupValues[] = [];
  const portBindings = container.HostConfig?.PortBindings || {};
  if (portBindings) {
    Object.keys(portBindings).forEach((portBinding) => {
      const portMappings = portBindings[portBinding];
      portMappings.forEach((portMapping: any) => {
        const host = portMapping.hostIp || portMapping.HostIp || "0.0.0.0";
        const port = portMapping.hostPort || portMapping.HostPort || 0;
        const item = {
          key: `${portBinding}`,
          value: `${host}`.indexOf("::") !== -1 ? `${host}${port}` : `${host}:${port}`,
        };
        containerPorts.push(item);
      });
    });
  }
  const groups: InspectGroup[] = [
    {
      name: "environment",
      title: t("Environment variables"),
      items: environmentVariables,
    },
    { name: "mounts", title: t("Mounts"), href: getVolumesUrl("mounts"), items: volumeMounts },
    { name: "ports", title: t("Ports"), items: containerPorts },
  ];
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <div className="AppScreenContent">
        <HTMLTable compact striped className="AppDataTable" data-table="container.inspect">
          <tbody>
            {groups.map((group) => {
              let items: any[] = [];
              if (group.name === "mounts") {
                items = group.items.map((item, index) => {
                  return (
                    <tr key={`group_${group.name}_${item.key}_${item.value}`}>
                      <td colSpan={2}>
                        <div className="ContainerVolume">
                          <div className="ContainerVolumeIndex">{index + 1}.</div>
                          <ul className="ContainerVolumeMapping">
                            <li>
                              <strong title={t("Host path")}>{t("Host")}</strong>
                              <code>{item.key}</code>
                            </li>
                            <li>
                              <strong title={t("Container path")}>{t("Container")}</strong>
                              <code>{item.value}</code>
                            </li>
                          </ul>
                        </div>
                      </td>
                    </tr>
                  );
                });
              } else {
                items = group.items.map((item) => {
                  return (
                    <tr key={`${group.name}_${item.key}_${item.value}`}>
                      <td>
                        <code>{item.key}</code>
                      </td>
                      <td>
                        <CopyButton text={item.value} />
                        &nbsp;
                        <span>{item.value}</span>
                      </td>
                    </tr>
                  );
                });
              }
              return (
                <React.Fragment key={group.name}>
                  <tr key={`group_${group.name}`} data-table-row="group.name" data-section-group={group.name}>
                    <td colSpan={2}>
                      {group.href ? (
                        <a className="ContainerInspectGroupLink" href={group.href}>
                          {group.title}
                        </a>
                      ) : (
                        group.title
                      )}
                    </td>
                  </tr>
                  {items}
                </React.Fragment>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Container Inspect");
Screen.Route = {
  Path: "/screens/container/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
