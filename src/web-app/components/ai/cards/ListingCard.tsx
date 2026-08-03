// Generative-UI card for listDirectory — the directory's entries as a name/kind table.
import { HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AICardShell } from "./AICardShell";
import { CardNotice } from "./CardNotice";
import type { ToolCardProps } from "./types";

interface DirEntry {
  name: string;
  kind: string;
}

export const ListingCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { path?: string; entries?: DirEntry[]; notice?: string };
  const entries = Array.isArray(data.entries) ? data.entries : [];
  // A pi title already reads "ls src", so repeating the path would say it twice.
  const heading = data.path && data.path !== "." && !title.includes(data.path) ? `${title} · ${data.path}` : title;

  return (
    <AICardShell title={heading} icon={IconNames.FOLDER_CLOSE}>
      {entries.length === 0 ? (
        <div className="AICardEmpty">{t("Empty directory.")}</div>
      ) : (
        <HTMLTable className="AICardTable" compact striped>
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Kind")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.name}>
                <td className="AICardStrong">{entry.name}</td>
                <td className="AICardMuted">{entry.kind}</td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}
      <CardNotice notice={data.notice} />
    </AICardShell>
  );
};
