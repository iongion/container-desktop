// Generative-UI card for readFile / writeFile — the file's contents in a scrollable monospaced block with a
// copy button, wrapped in the shared collapsible shell. Title is the workspace-relative path.
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { CopyButton } from "@/web-app/components/CopyButton";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

export const FileCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { path?: string; content?: string; contents?: string };
  const body = (data.content ?? data.contents ?? "").replace(/\n+$/, "");
  const title = data.path ? String(data.path) : t("File");

  return (
    <AICardShell title={title} icon={IconNames.DOCUMENT}>
      <div className="AICardLogsWrap">
        <span className="AICardLogsCopy">
          <CopyButton text={body} disabled={!body} />
        </span>
        <pre className="AICardLogs">{body || t("(empty file)")}</pre>
      </div>
    </AICardShell>
  );
};
