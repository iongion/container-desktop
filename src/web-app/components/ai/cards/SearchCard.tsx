// Generative-UI card for searchText (grep matches: path·line·text) and findFiles (matching paths). One card,
// two shapes: a matches table when the result carries `matches`, else a path list from `files`.
import { HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export const SearchCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { pattern?: string; files?: string[]; matches?: GrepMatch[] };
  const heading = data.pattern ? `${title} · "${data.pattern}"` : title;

  if (Array.isArray(data.matches)) {
    return (
      <AICardShell title={heading} icon={IconNames.SEARCH}>
        {data.matches.length === 0 ? (
          <div className="AICardEmpty">{t("No matches.")}</div>
        ) : (
          <HTMLTable className="AICardTable" compact striped>
            <thead>
              <tr>
                <th>{t("File")}</th>
                <th>{t("Line")}</th>
                <th>{t("Match")}</th>
              </tr>
            </thead>
            <tbody>
              {data.matches.map((m) => (
                <tr key={`${m.path}:${m.line}:${m.text}`}>
                  <td className="AICardStrong">{m.path}</td>
                  <td className="AICardMuted">{m.line}</td>
                  <td className="AICardMono">{m.text}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </AICardShell>
    );
  }

  const files = Array.isArray(data.files) ? data.files : [];
  return (
    <AICardShell title={heading} icon={IconNames.SEARCH}>
      {files.length === 0 ? (
        <div className="AICardEmpty">{t("No files.")}</div>
      ) : (
        <ul className="AICardPathList">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      )}
    </AICardShell>
  );
};
