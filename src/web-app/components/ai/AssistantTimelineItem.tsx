import { Button, ButtonGroup, Callout, Card, Icon, Intent, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import type { SessionTimelineItem, SessionView } from "@/ai-system/core/sessionEvents";
import { sessionTimelineMessageContent } from "@/ai-system/core/sessionReducer";
import type { SessionSummary } from "@/ai-system/core/sessions";
import { toolTitle } from "@/ai-system/ui/core/toolTitle";
import { AssistantMarkdown } from "@/web-app/components/ai/AssistantMarkdown";
import { DataCard } from "@/web-app/components/ai/cards/DataCard";
import { ToolCard } from "@/web-app/components/ai/cards/registry";
import { WorkspaceChangesCard } from "@/web-app/components/ai/WorkspaceChangesDrawer";

export interface AssistantTimelineContext {
  view?: SessionView;
  activeSession?: SessionSummary;
  activeSessionId?: string;
  rememberApprovals: boolean;
  onResolveApproval: (approvalId: string, decision: "allow" | "reject") => Promise<unknown>;
  onOpenWorkspaceChanges: () => void;
}

interface AssistantTimelineItemProps {
  item: SessionTimelineItem;
  timelineIndex: number;
  context: AssistantTimelineContext;
}

function ApprovalActions({
  item,
  context,
}: {
  item: Extract<SessionTimelineItem, { kind: "approval" }>;
  context: AssistantTimelineContext;
}) {
  const { t } = useTranslation();
  if (item.status === "allowed") {
    return (
      <Tag intent={Intent.SUCCESS} icon={IconNames.TICK} minimal>
        {t("Allowed")}
      </Tag>
    );
  }
  if (item.status === "rejected") {
    return (
      <Tag intent={Intent.DANGER} icon={IconNames.DISABLE} minimal>
        {t("Declined")}
      </Tag>
    );
  }
  const loading = item.status === "resolving";
  return (
    <ButtonGroup className="AssistantApprovalActions">
      <Button
        size="small"
        intent={Intent.PRIMARY}
        icon={IconNames.TICK}
        text={context.rememberApprovals ? t("Allow (remember)") : t("Allow")}
        loading={loading}
        onClick={() => void context.onResolveApproval(item.approvalId, "allow")}
      />
      <Button
        size="small"
        icon={IconNames.CROSS}
        text={context.rememberApprovals ? t("Reject (remember)") : t("Reject")}
        disabled={loading}
        onClick={() => void context.onResolveApproval(item.approvalId, "reject")}
      />
    </ButtonGroup>
  );
}

export function AssistantTimelineItem({ item, timelineIndex, context }: AssistantTimelineItemProps) {
  const { t } = useTranslation();
  switch (item.kind) {
    case "message": {
      const content = context.view ? sessionTimelineMessageContent(context.view, item, timelineIndex) : item.content;
      return (
        <div className={`AssistantMessage AssistantMessage--${item.role}`}>
          <div className="AssistantMessageContent">
            <AssistantMarkdown content={content || (item.status === "streaming" ? "…" : "")} />
          </div>
          {item.role === "user" && item.delivery === "queued" ? (
            <span className="AssistantMessageStatus">{t("Queued")}</span>
          ) : null}
          {item.role === "user" && item.delivery === "discarded" ? (
            <span className="AssistantMessageStatus">{t("Not sent")}</span>
          ) : null}
          {item.role === "assistant" && item.status === "interrupted" ? (
            <span className="AssistantMessageStatus">{t("Interrupted")}</span>
          ) : null}
          {item.role === "assistant" && item.status === "stopped" ? (
            <span className="AssistantMessageStatus">{t("Stopped")}</span>
          ) : null}
        </div>
      );
    }
    case "denied":
      return (
        <Callout intent={Intent.DANGER} icon={IconNames.BAN_CIRCLE}>
          {t("Rejected")}: <code>{toolTitle(item.tool, {}, t, item.title)}</code> — {item.reason}
        </Callout>
      );
    case "approval":
      return (
        <Card className="AssistantApproval" compact>
          <code className="AssistantCode">{toolTitle(item.tool, item.args, t, item.title)}</code>
          <span className="AssistantReason">{item.reason}</span>
          <ApprovalActions item={item} context={context} />
        </Card>
      );
    case "error":
      return <Callout intent={Intent.DANGER}>{item.message}</Callout>;
    case "notice":
      // Not an error: the turn ran and the model chose to say nothing, or its cap was reached before it could. The
      // words live here because the projector is pure and cannot translate.
      return (
        <Callout className="AssistantTurnNotice" intent={Intent.WARNING} icon={IconNames.INFO_SIGN}>
          {item.notice === "output-cap"
            ? t("The model reached its answer limit before writing anything.")
            : t("The model answered with nothing.")}
        </Callout>
      );
    case "workspace-changes":
      return <WorkspaceChangesCard summary={item} onOpen={context.onOpenWorkspaceChanges} />;
    case "data":
      return <DataCard customType={item.customType} data={item.data} text={item.text} />;
    case "tool":
      if (item.tool === "runCommand") {
        const result = item.result as
          | { program?: string; args?: string[]; stdout?: string; stderr?: string }
          | undefined;
        const program = typeof item.args.program === "string" ? item.args.program : result?.program;
        const args = Array.isArray(item.args.args) ? item.args.args.map(String) : (result?.args ?? []);
        return (
          <div className="AssistantCommand">
            <div className="AssistantStepHead">
              <Icon icon={IconNames.CONSOLE} size={12} />
              <code className="AssistantCode">
                {program} {args.join(" ")}
              </code>
            </div>
            {item.status !== "running" ? (
              <pre className="AssistantOutput">
                {item.message || result?.stdout || result?.stderr || t("(no output)")}
              </pre>
            ) : null}
          </div>
        );
      }
      return (
        <ToolCard
          {...item}
          sessionId={context.activeSessionId}
          title={toolTitle(item.tool, item.args, t, item.title)}
        />
      );
    default:
      return null;
  }
}
