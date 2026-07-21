// Generative-UI card for listImages — name:tag and a human-readable size per image.
import { HTMLTable } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { EngineImage } from "@/ai-system/core/types";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export const ImagesCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const items = (Array.isArray(result) ? result : []) as EngineImage[];
  return (
    <AICardShell title={title}>
      {items.length === 0 ? (
        <div className="AICardEmpty">{t("No images.")}</div>
      ) : (
        <HTMLTable className="AICardTable" compact striped>
          <thead>
            <tr>
              <th>{t("Repository")}</th>
              <th>{t("Tag")}</th>
              <th>{t("Size")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((image) => {
              const name = image.Name || image.FullName || image.Names?.[0] || String(image.Id ?? "").slice(0, 12);
              return (
                <tr key={String(image.Id)}>
                  <td className="AICardStrong">{name}</td>
                  <td className="AICardMuted">{image.Tag || "—"}</td>
                  <td className="AICardMuted">{formatBytes(image.Size)}</td>
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      )}
    </AICardShell>
  );
};
