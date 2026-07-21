// Generative-UI card for execCommand — the run command, its exit code, and combined stdout/stderr in a
// scrollable monospaced block with a copy button.
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { CopyButton } from "@/web-app/components/CopyButton";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

export const ExecCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as {
    program?: string;
    args?: string[];
    code?: number | null;
    stdout?: string;
    stderr?: string;
  };
  const command = [data.program ?? "", ...(data.args ?? [])].join(" ").trim();
  const output = [data.stdout, data.stderr]
    .filter((part) => part && part.length > 0)
    .join("\n")
    .replace(/\n+$/, "");

  return (
    <AICardShell title={command || t("Command")} icon={IconNames.CONSOLE}>
      <div className="AICardExecMeta">
        <span className="AICardExecMono">$ {command}</span>
        <span className="AICardSpacer" />
        <span>
          {t("exit")} {data.code ?? "?"}
        </span>
      </div>
      <div className="AICardLogsWrap">
        <span className="AICardLogsCopy">
          <CopyButton text={output} disabled={!output} />
        </span>
        <pre className="AICardLogs">{output || t("(no output)")}</pre>
      </div>
    </AICardShell>
  );
};
