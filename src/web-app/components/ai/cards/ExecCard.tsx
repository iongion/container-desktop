// Generative-UI card for execCommand — the run command, its exit code, and combined stdout/stderr in a
// scrollable monospaced block with a copy button.
import { AnchorButton, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@/logger";
import { CopyButton } from "@/web-app/components/CopyButton";
import { Notification } from "@/web-app/Notification";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

const logger = createLogger("web-app.ai.ExecCard");

export const ExecCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as {
    program?: string;
    args?: string[];
    code?: number | null;
    stdout?: string;
    stderr?: string;
    fullOutputPath?: string;
  };
  const readToolOutput = useCodingAgentStore((state) => state.readToolOutput);
  // The full output replaces the truncated body once read. Held here, not in the store: it belongs to this
  // card's disclosure, and a re-render of the transcript must not drop it.
  const [full, setFull] = useState<string>();
  const [loading, setLoading] = useState(false);

  const command = [data.program ?? "", ...(data.args ?? [])].join(" ").trim();
  const truncated = [data.stdout, data.stderr]
    .filter((part) => part && part.length > 0)
    .join("\n")
    .replace(/\n+$/, "");
  const output = full ?? truncated;

  const showFullOutput = async () => {
    if (!data.fullOutputPath) return;
    setLoading(true);
    try {
      const read = await readToolOutput(data.fullOutputPath);
      setFull(read.truncated ? `…\n${read.text}` : read.text);
    } catch (error) {
      // The truncated body is still on screen, so this is a failed expansion, not a failed command.
      logger.error("unable to read the full tool output", error);
      Notification.show({ message: (error as Error).message, intent: Intent.WARNING });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AICardShell title={title || command || t("Command")} icon={IconNames.CONSOLE}>
      <div className="AICardExecMeta">
        <span className="AICardExecMono">$ {command}</span>
        <span className="AICardSpacer" />
        {/* pi's bash reports no exit code — a non-zero exit arrives as an error instead — so the chip is shown
            only by a tool that actually returns one. */}
        {typeof data.code === "number" ? (
          <span>
            {t("exit")} {data.code}
          </span>
        ) : null}
        {/* pi wrote the whole output to a file in the agent container; only the host can open it. */}
        {data.fullOutputPath && !full ? (
          <AnchorButton
            className="AICardExecFullOutput"
            variant="minimal"
            size="small"
            icon={IconNames.EXPAND_ALL}
            text={t("Show full output")}
            loading={loading}
            onClick={() => void showFullOutput()}
          />
        ) : null}
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
