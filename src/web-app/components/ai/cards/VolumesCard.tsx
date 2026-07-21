// Generative-UI card for listVolumes — name, driver and mountpoint per volume.
import { HTMLTable } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { EngineVolume } from "@/ai-system/core/types";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

export const VolumesCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const items = (Array.isArray(result) ? result : []) as EngineVolume[];
  return (
    <AICardShell title={title}>
      {items.length === 0 ? (
        <div className="AICardEmpty">{t("No volumes.")}</div>
      ) : (
        <HTMLTable className="AICardTable" compact striped>
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Driver")}</th>
              <th>{t("Mountpoint")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((volume) => (
              <tr key={volume.Name}>
                <td className="AICardStrong">{volume.Name}</td>
                <td className="AICardMuted">{volume.Driver || "—"}</td>
                <td className="AICardMuted AICardMono">{volume.Mountpoint}</td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}
    </AICardShell>
  );
};
