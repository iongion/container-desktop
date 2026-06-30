// Generative-UI card for an approved mutation (start/stop/remove/pull/…). The result is a compact
// { ok, op, id }; a failed op is already rendered as a danger callout by <ToolCard>, so this only renders
// the success confirmation.
import { Callout, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import type { ToolCardProps } from "./types";

export const ActionResultCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const ok = (result as { ok?: boolean } | undefined)?.ok !== false;
  return (
    <Callout
      className="AICard"
      intent={ok ? Intent.SUCCESS : Intent.DANGER}
      icon={ok ? IconNames.TICK : IconNames.CROSS}
    >
      {title} — {ok ? t("done") : t("failed")}
    </Callout>
  );
};
