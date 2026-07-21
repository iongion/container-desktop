// Generative-UI card for listNetworks — name and driver per network.
import { HTMLTable, Tag } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { EngineNetwork } from "@/ai-system/core/types";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

export const NetworksCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const items = (Array.isArray(result) ? result : []) as EngineNetwork[];
  return (
    <AICardShell title={title}>
      {items.length === 0 ? (
        <div className="AICardEmpty">{t("No networks.")}</div>
      ) : (
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
      )}
    </AICardShell>
  );
};
