// Generative-UI card for listNetworks — name and driver per network.
import { HTMLTable, Tag } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { Network } from "@/env/Types";

import type { ToolCardProps } from "./types";

export const NetworksCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const items = (Array.isArray(result) ? result : []) as Network[];
  if (items.length === 0) {
    return <div className="AICardEmpty">{t("No networks.")}</div>;
  }
  return (
    <div className="AICard">
      <HTMLTable className="AICardTable" compact striped>
        <thead>
          <tr>
            <th>{t("Name")}</th>
            <th>{t("Driver")}</th>
            <th>{t("DNS")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((network) => (
            <tr key={String(network.id || network.name)}>
              <td className="AICardStrong">{network.name}</td>
              <td className="AICardMuted">{network.driver || "—"}</td>
              <td>
                {network.dns_enabled ? <Tag minimal>{t("on")}</Tag> : <span className="AICardMuted">{t("off")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  );
};
