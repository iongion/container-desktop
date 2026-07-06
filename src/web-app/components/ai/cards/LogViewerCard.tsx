// Generative-UI card for getContainerLogs — a scrollable monospaced log block with a copy button.
import { Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { CopyButton } from "@/web-app/components/CopyButton";
import type { ToolCardProps } from "./types";

export const LogViewerCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { id?: string; logs?: string };
  const logs = (data.logs ?? "").trimEnd();

  return (
    <div className="AICard">
      <div className="AICardHead">
        <Icon icon={IconNames.CONSOLE} size={12} />
        <span className="AICardTitle">{data.id ? `${t("Logs")} · ${String(data.id).slice(0, 12)}` : t("Logs")}</span>
        <span className="AICardSpacer" />
        <CopyButton text={logs} disabled={!logs} />
      </div>
      <pre className="AICardLogs">{logs || t("(no output)")}</pre>
    </div>
  );
};
