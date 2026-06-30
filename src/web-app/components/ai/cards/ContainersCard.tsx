// Generative-UI card for listContainers — a compact table with a colored state Tag per container.
import { HTMLTable, Intent, Tag } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { Container } from "@/env/Types";

import type { ToolCardProps } from "./types";

function stateIntent(state: string): Intent {
  switch ((state || "").toLowerCase()) {
    case "running":
      return Intent.SUCCESS;
    case "paused":
      return Intent.WARNING;
    case "exited":
    case "stopped":
    case "dead":
    case "error":
      return Intent.DANGER;
    default:
      return Intent.NONE;
  }
}

export const ContainersCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const items = (Array.isArray(result) ? result : []) as Container[];
  if (items.length === 0) {
    return <div className="AICardEmpty">{t("No containers.")}</div>;
  }
  return (
    <div className="AICard">
      <HTMLTable className="AICardTable" compact striped>
        <thead>
          <tr>
            <th>{t("Name")}</th>
            <th>{t("Image")}</th>
            <th>{t("State")}</th>
            <th>{t("Status")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const name = c.Computed?.Name ?? c.Name ?? c.Names?.[0] ?? String(c.Id ?? "").slice(0, 12);
            const state = String(c.Computed?.DecodedState ?? (typeof c.State === "string" ? c.State : c.Status) ?? "");
            return (
              <tr key={String(c.Id)}>
                <td className="AICardStrong">{name}</td>
                <td className="AICardMuted">{c.Image ?? c.ImageName}</td>
                <td>
                  <Tag minimal intent={stateIntent(state)}>
                    {state}
                  </Tag>
                </td>
                <td className="AICardMuted">{c.Status}</td>
              </tr>
            );
          })}
        </tbody>
      </HTMLTable>
    </div>
  );
};
