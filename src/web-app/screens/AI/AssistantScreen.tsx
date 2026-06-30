// The always-agentic assistant: the model always has its gated tools, and what a tool call does is
// decided by the global permission mode (the composer's dropdown). The conversation is a single
// seq-ordered timeline — prose, command steps, results, and approval cards interleaved in arrival order.
// Approval cards send a decision (Allow/Reject); the broker runs/persists per mode and resumes the turn.
// The transcript auto-follows new output and "demagnetizes" the moment the user scrolls up, with a
// bottom-center button to re-follow. Gated by Metadata.RequiresAI.
import { Button, Callout, Card, Icon, Intent, NonIdealState, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AIPermissionMode } from "@/ai-system/core";
import { hasPendingApproval, type TranscriptItem } from "@/ai-system/ui/core/transcript";
import { startAIBus, useAIStore } from "@/ai-system/ui/react/stores/useAIStore";
import { AIComposer } from "@/web-app/components/AIComposer";
import { ToolCard } from "@/web-app/components/ai/cards/registry";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import "./AssistantScreen.css";

export const ID = "ai.assistant";
export const Title = "Assistant";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();

  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const timelines = useAIStore((s) => s.timelines);
  const busy = useAIStore((s) => s.busy);
  const sendMessage = useAIStore((s) => s.sendMessage);
  const resolveApproval = useAIStore((s) => s.resolveApproval);
  const cancel = useAIStore((s) => s.cancel);
  const newSession = useAIStore((s) => s.newSession);
  const mode: AIPermissionMode = useAppStore((s) => s.userSettings.ai?.permissionMode) ?? "ask";

  useEffect(() => {
    startAIBus();
    if (!useAIStore.getState().activeSessionId) {
      useAIStore.getState().newSession();
    }
  }, []);

  const items = (activeSessionId ? timelines[activeSessionId] : undefined) ?? [];
  const streaming = !!(activeSessionId && busy[activeSessionId]);
  // The model has stopped but is waiting on the user's decision for a surfaced action.
  const awaitingApproval = !streaming && hasPendingApproval(items);

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
    if (autoFollow && items.length > 0) {
      scrollToBottom();
    }
  }, [items, autoFollow, scrollToBottom]);

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
    void sendMessage(text, { providerId, model });
  };

  // "(remember)" hint only in the persisting mode, so the user knows the choice will stick.
  const remember = mode === "remember";
  const renderApprovalActions = (item: Extract<TranscriptItem, { kind: "approval" }>) => {
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
      <div className="AssistantApprovalActions">
        <Button
          size="small"
          intent={Intent.PRIMARY}
          icon={IconNames.TICK}
          text={remember ? t("Allow (remember)") : t("Allow")}
          loading={loading}
          onClick={() => resolveApproval(item.actionId, "allow")}
        />
        <Button
          size="small"
          icon={IconNames.CROSS}
          text={remember ? t("Reject (remember)") : t("Reject")}
          disabled={loading}
          onClick={() => resolveApproval(item.actionId, "reject")}
        />
      </div>
    );
  };

  const renderItem = (item: TranscriptItem) => {
    switch (item.kind) {
      case "message":
        return (
          <div key={item.id} className={`AssistantMessage AssistantMessage--${item.role}`}>
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ children }) {
                  return <code className="AssistantCode">{children}</code>;
                },
              }}
            >
              {item.content || (item.streaming ? "…" : "")}
            </Markdown>
          </div>
        );
      case "command":
        return (
          <div key={item.id} className="AssistantStep">
            <div className="AssistantStepHead">
              <Icon icon={IconNames.CONSOLE} size={12} />
              <code className="AssistantCode">
                {item.program} {item.args.join(" ")}
              </code>
            </div>
          </div>
        );
      case "command-result":
        return (
          <pre key={item.id} className="AssistantOutput">
            {item.stdout || item.stderr || t("(no output)")}
          </pre>
        );
      case "rejected":
        return (
          <Callout key={item.id} intent={Intent.DANGER} icon={IconNames.BAN_CIRCLE}>
            {t("Rejected")}: <code>{item.program}</code> — {item.reason}
          </Callout>
        );
      case "approval":
        return (
          <Card key={item.id} className="AssistantApproval" compact>
            <code className="AssistantCode">
              {item.cmdKind === "tool"
                ? (item.title ?? item.program)
                : item.cmdKind === "web"
                  ? `${t("Web search")}: ${item.args[0] ?? ""}`
                  : `${item.program} ${item.args.join(" ")}`}
            </code>
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
        // First-class typed tool → generative-UI card (with a generic JSON fallback for un-carded tools).
        return <ToolCard key={item.id} {...item} />;
      default:
        return null;
    }
  };

  const showJump = !atBottom && items.length > 0;

  return (
    <div className="AppScreen" data-screen={ID}>
      <div className="AssistantScroll">
        <div className="AssistantTranscript" ref={scrollRef} onScroll={onScroll}>
          {items.length === 0 ? (
            <NonIdealState icon={<Icon icon={IconNames.CHAT} size={48} />} title={t("What can I help you with?")} />
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

      <AIComposer
        placeholder={t("Message the assistant… (Enter to send, Shift+Enter for newline)")}
        streaming={streaming}
        awaitingResponse={awaitingApproval}
        onStop={cancel}
        onSubmit={onSubmit}
        showPermissionMode
        leadingActions={
          <Button
            className="AIComposerTool"
            variant="minimal"
            size="small"
            icon={IconNames.PLUS}
            title={t("New chat")}
            aria-label={t("New chat")}
            onClick={() => newSession()}
          />
        }
      />
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/assistant",
};
Screen.Metadata = {
  LeftIcon: IconNames.CHAT,
  RequiresAI: true,
  ExcludeFromSidebar: true, // reached via the header AI menu, not the sidebar
};
