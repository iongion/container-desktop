// Tool → card registry + the <ToolCard> dispatcher rendered by AssistantScreen for every `tool` transcript
// item. The dispatcher owns the shared states (running spinner / error callout) so each card only renders
// its successful, typed result. A tool with NO registered card falls back to a titled JSON view — so adding
// a tool never breaks the transcript; it just renders generically until a card is written for it.
import { Callout, Intent, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { redactPayload } from "@/ai-system/core/redact";
import { type ContainerToolName, isContainerToolName } from "@/ai-system/core/toolNames";
import { isWorkspaceToolName, type WorkspaceToolName } from "@/ai-system/core/workspaceToolNames";
import { ActionResultCard } from "./ActionResultCard";
import { AICardShell } from "./AICardShell";
import { ContainersCard } from "./ContainersCard";
import { DiffCard } from "./DiffCard";
import { ExecCard } from "./ExecCard";
import { FileCard } from "./FileCard";
import { ImagesCard } from "./ImagesCard";
import { ListingCard } from "./ListingCard";
import { LogViewerCard } from "./LogViewerCard";
import { NetworksCard } from "./NetworksCard";
import { SearchCard } from "./SearchCard";
import type { ToolCardProps } from "./types";
import { VolumesCard } from "./VolumesCard";

import "./cards.css";

const TOOL_CARDS: Partial<Record<ContainerToolName, React.FC<ToolCardProps>>> = {
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

// Workspace tools route to a parallel map (their names aren't ContainerToolNames, so the container map never sees
// them). statPath / removePath have no dedicated view → the generic JSON card.
const WORKSPACE_TOOL_CARDS: Partial<Record<WorkspaceToolName, React.FC<ToolCardProps>>> = {
  readFile: FileCard,
  writeFile: FileCard,
  editFile: DiffCard,
  listDirectory: ListingCard,
  findFiles: SearchCard,
  searchText: SearchCard,
  execCommand: ExecCard,
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const GenericToolCard: React.FC<ToolCardProps> = ({ title, result }) => (
  <AICardShell title={title}>
    {result !== undefined && result !== null ? (
      <pre className="AICardJson">{safeJson(redactPayload(result))}</pre>
    ) : null}
  </AICardShell>
);

export const ToolCard: React.FC<ToolCardProps> = (props) => {
  const { t } = useTranslation();
  const { tool, title, status, ok, result, message } = props;

  if (status === "running") {
    return (
      <div className="AICard AICard--running">
        <Spinner size={14} />
        <span className="AICardTitle">{title}…</span>
      </div>
    );
  }
  if (status === "error" || ok === false) {
    const errorMessage =
      message ?? (result as { error?: string; message?: string } | undefined)?.error ?? t("The tool call failed.");
    return (
      <Callout className="AICard" intent={Intent.DANGER} icon={IconNames.ERROR} title={title}>
        {String(errorMessage)}
      </Callout>
    );
  }

  const Card =
    (isContainerToolName(tool)
      ? TOOL_CARDS[tool]
      : isWorkspaceToolName(tool)
        ? WORKSPACE_TOOL_CARDS[tool]
        : undefined) ?? GenericToolCard;
  return <Card {...props} />;
};
