// Generative-UI card for listVolumes — name, driver and mountpoint per volume.
import { HTMLTable } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { Volume } from "@/env/Types";

import type { ToolCardProps } from "./types";

export const VolumesCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const items = (Array.isArray(result) ? result : []) as Volume[];
  if (items.length === 0) {
    return <div className="AICardEmpty">{t("No volumes.")}</div>;
  }
  return (
    <div className="AICard">
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
    </div>
  );
};
