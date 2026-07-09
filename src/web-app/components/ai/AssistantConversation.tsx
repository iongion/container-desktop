// The shared assistant conversation: the ordered transcript (prose, command steps, results, approval cards,
// tool → generative-UI cards) plus the AIComposer. Rendered by BOTH the full-page AssistantScreen and the
// summonable quake console, against the SAME useAIStore session, so a conversation is continuous across
// surfaces. Layout-only: it fills its parent as a flex column; the surface (screen vs console body) owns the
// outer chrome. Extracted from AssistantScreen so the two surfaces can never drift.
import { Button, ButtonGroup, Callout, Card, Icon, Intent, NonIdealState, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type AIPermissionMode, DEFAULT_AI_SETTINGS } from "@/ai-system/core";
import { hasPendingApproval, type TranscriptItem } from "@/ai-system/ui/core/transcript";
import { startAIBus, useAIStore } from "@/ai-system/ui/react/stores/useAIStore";
import type { AISettings } from "@/env/Types";
import { resolveScreenPrompt } from "@/prompt/screenPrompts";
import { AIComposer } from "@/web-app/components/AIComposer";
import { AssistantMarkdown } from "@/web-app/components/ai/AssistantMarkdown";
import { ToolCard } from "@/web-app/components/ai/cards/registry";
import { useAppStore } from "@/web-app/stores/appStore";
import { useUIStore } from "@/web-app/stores/uiStore";

import "./AssistantConversation.css";

export interface AssistantConversationProps {
  // Extra class on the flex-column root (e.g. the console passes one to scope tweaks).
  className?: string;
  composerPlaceholder?: string;
}

export const AssistantConversation: React.FC<AssistantConversationProps> = ({ className, composerPlaceholder }) => {
  const { t } = useTranslation();

  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const timelines = useAIStore((s) => s.timelines);
  const busy = useAIStore((s) => s.busy);
  const sendMessage = useAIStore((s) => s.sendMessage);
  const resolveApproval = useAIStore((s) => s.resolveApproval);
  const cancel = useAIStore((s) => s.cancel);
  const newSession = useAIStore((s) => s.newSession);
  const mode: AIPermissionMode = useAppStore((s) => s.userSettings.ai?.permissionMode) ?? "ask";
  const ai: AISettings = useAppStore((s) => s.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  // Per-screen starter questions for the empty state (chips), from the current screen the user is on.
  const screenId = useUIStore((s) => s.currentScreen.id);
  const suggestions = resolveScreenPrompt(screenId).suggestions;

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

  // Starter chips send immediately with the saved default provider/model (the same seed the composer uses).
  const onStarter = (text: string) => {
    void sendMessage(text, {
      providerId: ai.defaultProvider,
      model: ai.providers?.[ai.defaultProvider]?.model ?? "",
    });
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
      <ButtonGroup className="AssistantApprovalActions">
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
      </ButtonGroup>
    );
  };

  const renderItem = (item: TranscriptItem) => {
    switch (item.kind) {
      case "message":
        return (
          <div key={item.id} className={`AssistantMessage AssistantMessage--${item.role}`}>
            <AssistantMarkdown content={item.content || (item.streaming ? "…" : "")} />
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
    <div className={`AssistantConversation${className ? ` ${className}` : ""}`}>
      <div className="AssistantScroll">
        <div className="AssistantTranscript" ref={scrollRef} onScroll={onScroll}>
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

      <AIComposer
        placeholder={composerPlaceholder ?? t("Message the assistant… (Enter to send, Shift+Enter for newline)")}
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
