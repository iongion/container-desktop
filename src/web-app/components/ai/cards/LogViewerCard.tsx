// Generative-UI card for getContainerLogs — a scrollable monospaced log block with a copy button.
import { Button, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ToolCardProps } from "./types";

export const LogViewerCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { id?: string; logs?: string };
  const logs = (data.logs ?? "").trimEnd();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(logs).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="AICard">
      <div className="AICardHead">
        <Icon icon={IconNames.CONSOLE} size={12} />
        <span className="AICardTitle">{data.id ? `${t("Logs")} · ${String(data.id).slice(0, 12)}` : t("Logs")}</span>
        <span className="AICardSpacer" />
        <Button
          variant="minimal"
          size="small"
          icon={copied ? IconNames.TICK : IconNames.DUPLICATE}
          title={t("Copy")}
          aria-label={t("Copy")}
          disabled={!logs}
          onClick={copy}
        />
      </div>
      <pre className="AICardLogs">{logs || t("(no output)")}</pre>
    </div>
  );
};
