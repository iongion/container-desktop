// Tool → card registry + the <ToolCard> dispatcher rendered by AssistantScreen for every `tool` transcript
// item. The dispatcher owns the shared states (running spinner / error callout) so each card only renders
// its successful, typed result. A tool with NO registered card falls back to a titled JSON view — so adding
// a tool never breaks the transcript; it just renders generically until a card is written for it.
import { Callout, Icon, Intent, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { ActionResultCard } from "./ActionResultCard";
import { ContainersCard } from "./ContainersCard";
import { ImagesCard } from "./ImagesCard";
import { LogViewerCard } from "./LogViewerCard";
import { NetworksCard } from "./NetworksCard";
import type { ToolCardProps } from "./types";
import { VolumesCard } from "./VolumesCard";

import "./cards.css";

const TOOL_CARDS: Record<string, React.FC<ToolCardProps>> = {
  listContainers: ContainersCard,
  listImages: ImagesCard,
  listNetworks: NetworksCard,
  listVolumes: VolumesCard,
  getContainerLogs: LogViewerCard,
  // Mutations → a success confirmation callout.
  startContainer: ActionResultCard,
  stopContainer: ActionResultCard,
  restartContainer: ActionResultCard,
  pauseContainer: ActionResultCard,
  unpauseContainer: ActionResultCard,
  removeContainer: ActionResultCard,
  removeImage: ActionResultCard,
  removeNetwork: ActionResultCard,
  removeVolume: ActionResultCard,
  pullImage: ActionResultCard,
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const GenericToolCard: React.FC<ToolCardProps> = ({ title, result }) => (
  <div className="AICard">
    <div className="AICardHead">
      <Icon icon={IconNames.DATABASE} size={12} />
      <span className="AICardTitle">{title}</span>
    </div>
    {result !== undefined && result !== null ? <pre className="AICardJson">{safeJson(result)}</pre> : null}
  </div>
);

export const ToolCard: React.FC<ToolCardProps> = (props) => {
  const { t } = useTranslation();
  const { tool, title, status, ok, result } = props;

  if (status === "running") {
    return (
      <div className="AICard AICard--running">
        <Spinner size={14} />
        <span className="AICardTitle">{title}…</span>
      </div>
    );
  }
  if (status === "error" || ok === false) {
    const message = (result as { error?: string; message?: string } | undefined)?.error ?? t("The tool call failed.");
    return (
      <Callout className="AICard" intent={Intent.DANGER} icon={IconNames.ERROR} title={title}>
        {String(message)}
      </Callout>
    );
  }

  const Card = TOOL_CARDS[tool] ?? GenericToolCard;
  return <Card {...props} />;
};
