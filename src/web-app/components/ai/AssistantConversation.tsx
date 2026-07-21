// The shared assistant conversation: the ordered transcript (prose, command steps, results, approval cards,
// tool → generative-UI cards) plus the AIComposer. Rendered by BOTH the full-page AssistantScreen and the
// summonable quake console, against the SAME useAIStore session, so a conversation is continuous across
// surfaces. Layout-only: it fills its parent as a flex column; the surface (screen vs console body) owns the
// outer chrome. Extracted from AssistantScreen so the two surfaces can never drift.
import { Button, ButtonGroup, Callout, Card, Icon, Intent, NonIdealState, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiFileDocumentPlusOutline } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatTimelineItem } from "@/ai-system/core/chatEvents";
import { chatTimelineMessageContent } from "@/ai-system/core/chatReducer";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import type { AISettings } from "@/ai-system/core/types";
import { toolTitle } from "@/ai-system/ui/core/toolTitle";
import { resolveScreenPrompt } from "@/template/screenPrompts";
import { AIComposer } from "@/web-app/components/AIComposer";
import { AssistantMarkdown } from "@/web-app/components/ai/AssistantMarkdown";
import { ToolCard } from "@/web-app/components/ai/cards/registry";
import { ThinkingStatus } from "@/web-app/components/ai/ThinkingStatus";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { useAppStore } from "@/web-app/stores/appStore";
import { useUIStore } from "@/web-app/stores/uiStore";
import { useAIStore } from "@/web-app/stores/useAIStore";

import "./AssistantConversation.css";

export interface AssistantConversationProps {
  // Extra class on the flex-column root (e.g. the console passes one to scope tweaks).
  className?: string;
  composerPlaceholder?: string;
}

export const AssistantConversation: React.FC<AssistantConversationProps> = ({ className, composerPlaceholder }) => {
  const { t } = useTranslation();

  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const sessions = useAIStore((s) => s.sessions);
  const views = useAIStore((s) => s.views);
  const recoveryErrors = useAIStore((s) => s.recoveryErrors);
  const submitMessage = useAIStore((s) => s.submitMessage);
  const resolveApproval = useAIStore((s) => s.resolveApproval);
  const cancel = useAIStore((s) => s.cancel);
  const newSession = useAIStore((s) => s.newSession);
  const setActiveSession = useAIStore((s) => s.setActiveSession);
  const deleteSession = useAIStore((s) => s.deleteSession);
  const deletingSessions = useAIStore((s) => s.deletingSessions);
  const mode: AIPermissionMode = useAppStore((s) => s.userSettings.ai?.permissionMode) ?? "ask";
  const ai: AISettings = useAppStore((s) => s.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  // Per-screen starter questions for the empty state (chips), from the current screen the user is on.
  const screenId = useUIStore((s) => s.currentScreen.id);
  const suggestions = resolveScreenPrompt(screenId).suggestions;

  const view = activeSessionId ? views[activeSessionId] : undefined;
  const recoveryError = activeSessionId ? recoveryErrors[activeSessionId] : undefined;
  const items = view?.timeline ?? [];
  const streamingContent = view?.streamingAssistant?.content ?? "";
  const phase = view?.phase ?? "idle";
  const pendingApproval = items.some(
    (item) => item.kind === "approval" && (item.status === "pending" || item.status === "resolving"),
  );
  const composerPhase = pendingApproval ? "awaiting-approval" : phase;
  const streaming =
    !pendingApproval && (phase === "model" || phase === "tool" || phase === "interrupting" || phase === "stopping");

  // Auto-follow ("magnetized") keeps the view pinned to the latest output. Scrolling up demagnetizes it
  // so the user can read past output while the model keeps streaming below; returning to the bottom (or
  // pressing the jump button) re-magnetizes. atBottom drives the button's visibility.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (autoFollow && (items.length > 0 || streamingContent.length > 0)) {
      scrollToBottom();
    }
  }, [items, streamingContent, autoFollow, scrollToBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(near);
    setAutoFollow(near); // scrolling away demagnetizes; returning to the bottom re-magnetizes
  }, []);

  const jumpToBottom = useCallback(() => {
    setAutoFollow(true);
    scrollToBottom();
  }, [scrollToBottom]);

  const onSubmit = (text: string, { providerId, model }: { providerId: string; model: string }) => {
    return submitMessage(text, { providerId, model });
  };

  // Starter chips send immediately with the saved default provider/model (the same seed the composer uses).
  const onStarter = (text: string) => {
    void submitMessage(text, {
      providerId: ai.defaultProvider,
      model: ai.providers?.[ai.defaultProvider]?.model ?? "",
    });
  };

  // "(remember)" hint only in the persisting mode, so the user knows the choice will stick.
  const remember = mode === "remember";
  const renderApprovalActions = (item: Extract<ChatTimelineItem, { kind: "approval" }>) => {
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
    const loading = item.status === "resolving" || phase !== "awaiting-approval";
    return (
      <ButtonGroup className="AssistantApprovalActions">
        <Button
          size="small"
          intent={Intent.PRIMARY}
          icon={IconNames.TICK}
          text={remember ? t("Allow (remember)") : t("Allow")}
          loading={loading}
          onClick={() => void resolveApproval(item.approvalId, "allow")}
        />
        <Button
          size="small"
          icon={IconNames.CROSS}
          text={remember ? t("Reject (remember)") : t("Reject")}
          disabled={loading}
          onClick={() => void resolveApproval(item.approvalId, "reject")}
        />
      </ButtonGroup>
    );
  };

  const renderItem = (item: ChatTimelineItem, timelineIndex: number) => {
    switch (item.kind) {
      case "message": {
        const content = view ? chatTimelineMessageContent(view, item, timelineIndex) : item.content;
        return (
          <div key={item.id} className={`AssistantMessage AssistantMessage--${item.role}`}>
            <AssistantMarkdown content={content || (item.status === "streaming" ? "…" : "")} />
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
          <Callout key={item.id} intent={Intent.DANGER} icon={IconNames.BAN_CIRCLE}>
            {t("Rejected")}: <code>{toolTitle(item.tool, {}, t, item.title)}</code> — {item.reason}
          </Callout>
        );
      case "approval":
        return (
          <Card key={item.id} className="AssistantApproval" compact>
            <code className="AssistantCode">{toolTitle(item.tool, item.args, t, item.title)}</code>
            <span className="AssistantReason">{item.reason}</span>
            {renderApprovalActions(item)}
          </Card>
        );
      case "error":
        return (
          <Callout key={item.id} intent={Intent.DANGER}>
            {item.message}
          </Callout>
        );
      case "tool":
        if (item.tool === "runCommand") {
          const result = item.result as
            | { program?: string; args?: string[]; stdout?: string; stderr?: string }
            | undefined;
          const program = typeof item.args.program === "string" ? item.args.program : result?.program;
          const args = Array.isArray(item.args.args) ? item.args.args.map(String) : (result?.args ?? []);
          return (
            <div key={item.id} className="AssistantCommand">
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
        return <ToolCard key={item.id} {...item} title={toolTitle(item.tool, item.args, t, item.title)} />;
      default:
        return null;
    }
  };

  const showJump = !atBottom && items.length > 0;
  const conversations = [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
  const conversationIcon = (conversation: (typeof conversations)[number]) => {
    switch (conversation.phase) {
      case "awaiting-approval":
        return IconNames.HELP;
      case "error":
        return IconNames.ERROR;
      case "model":
      case "tool":
      case "interrupting":
      case "stopping":
        return IconNames.TIME;
      default:
        return IconNames.CHAT;
    }
  };

  return (
    <div className={`AssistantConversation${className ? ` ${className}` : ""}`}>
      <div className="AssistantConversationHistory" role="tablist" aria-label={t("Chat history")}>
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`AssistantConversationTab${conversation.id === activeSessionId ? " is-active" : ""}`}
          >
            <Button
              role="tab"
              aria-selected={conversation.id === activeSessionId}
              variant="minimal"
              size="small"
              icon={conversationIcon(conversation)}
              text={conversation.title}
              title={conversation.title}
              onClick={() => setActiveSession(conversation.id)}
            />
            <ConfirmMenu
              tag={conversation.id}
              title={t("Delete conversation")}
              disabled={deletingSessions.has(conversation.id)}
              onConfirm={(id, confirmed) => {
                if (confirmed) void deleteSession(String(id));
              }}
            />
          </div>
        ))}
      </div>
      <div className="AssistantScroll">
        <div className="AssistantTranscript" ref={scrollRef} onScroll={onScroll}>
          {recoveryError ? <Callout intent={Intent.DANGER}>{recoveryError}</Callout> : null}
          {items.length === 0 ? (
            <div className="AssistantEmpty">
              <NonIdealState icon={<Icon icon={IconNames.CHAT} size={40} />} title={t("What can I help you with?")} />
              {suggestions.length > 0 ? (
                <div className="AssistantStarters">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="AssistantStarterChip" onClick={() => onStarter(s)}>
                      {t(s)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            items.map(renderItem)
          )}
        </div>
        {showJump ? (
          <Button
            className={`AssistantJump${streaming ? " AssistantJump--blink" : ""}`}
            icon={IconNames.DOUBLE_CHEVRON_DOWN}
            title={t("Jump to latest")}
            aria-label={t("Jump to latest")}
            onClick={jumpToBottom}
          />
        ) : null}
      </div>

      <div className="AssistantComposerDock">
        <AIComposer
          placeholder={composerPlaceholder ?? t("Message the assistant… (Enter to send, Shift+Enter for newline)")}
          phase={composerPhase}
          onStop={cancel}
          onSubmit={onSubmit}
          statusLeading={streaming ? <ThinkingStatus /> : null}
          showPermissionMode
          leadingActions={
            <Button
              className="AIComposerTool"
              variant="minimal"
              size="small"
              icon={<ReactIcon.Icon className="ReactIcon" path={mdiFileDocumentPlusOutline} size={0.75} />}
              title={t("New chat")}
              aria-label={t("New chat")}
              onClick={() => void newSession()}
            />
          }
        />
      </div>
    </div>
  );
};
