// Generative-UI card for getContainerLogs — a scrollable monospaced log block with a copy button, wrapped
// in the shared collapsible card shell.
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { CopyButton } from "@/web-app/components/CopyButton";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

export const LogViewerCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { id?: string; logs?: string };
  const logs = (data.logs ?? "").trimEnd();
  const title = data.id ? `${t("Logs")} · ${String(data.id).slice(0, 12)}` : t("Logs");

  return (
    <AICardShell title={title} icon={IconNames.CONSOLE}>
      <div className="AICardLogsWrap">
        <span className="AICardLogsCopy">
          <CopyButton text={logs} disabled={!logs} />
        </span>
        <pre className="AICardLogs">{logs || t("(no output)")}</pre>
      </div>
    </AICardShell>
  );
};
