// Generative-UI card for searchText (grep matches: path·line·text) and findFiles (matching paths). One card,
// two shapes: a matches table when the result carries `matches`, else a path list from `files`.
import { HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AICardShell } from "./AICardShell";
import { CardNotice } from "./CardNotice";
import type { ToolCardProps } from "./types";

interface GrepMatch {
  path: string;
  line: number;
  text: string;
  context?: boolean;
}

export const SearchCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { pattern?: string; files?: string[]; matches?: GrepMatch[]; notice?: string };
  // A pi title already reads "grep TODO in src", so repeating the pattern would say it twice.
  const heading = data.pattern && !title.includes(data.pattern) ? `${title} · "${data.pattern}"` : title;

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
                  <td className={m.context ? "AICardMuted" : "AICardStrong"}>{m.path}</td>
                  <td className="AICardMuted">{m.line}</td>
                  {/* grep's own context lines are shown muted, so a hit still stands out among them. */}
                  <td className={m.context ? "AICardMono AICardMuted" : "AICardMono"}>{m.text}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
        <CardNotice notice={data.notice} />
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
      <CardNotice notice={data.notice} />
    </AICardShell>
  );
};
