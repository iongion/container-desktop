// Shared AI composer — the ONE way to talk to the AI anywhere in the app. A rounded box
// with a borderless textarea and a footer-minimal toolbar: optional leading actions, an optional
// permission-mode dropdown (Assistant only), the ModelPicker (source → provider → model), and a circular
// send/stop. The composer keeps only the current {providerId, model} for submit, so every
// AI surface (the Assistant and Goal runs) gets the identical interaction by rendering <AIComposer onSubmit=…/>.
import { Button, Intent, Menu, MenuItem, PopoverNext, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatPhase } from "@/ai-system/core/chatEvents";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import type { AISettings } from "@/ai-system/core/types";
import { commandHistory, navigateHistory, pushCommand } from "@/ai-system/ui/core/commandHistory";
import { ConfirmMenuItem } from "@/web-app/components/ConfirmMenu";
import { useAppStore } from "@/web-app/stores/appStore";

import { ModelPicker, type ModelPickerValue } from "./ModelPicker";

import "./AIComposer.css";

export interface AIComposerContext {
  providerId: string;
  model: string;
}

export interface AIComposerProps {
  // Called with the (trimmed, non-empty) text and the chosen provider/model when the user sends.
  onSubmit: (text: string, ctx: AIComposerContext) => unknown | Promise<unknown>;
  phase?: ChatPhase;
  onStop?: () => Promise<void> | void;
  placeholder?: string;
  // Optional left-aligned toolbar content, e.g. the Assistant's "New chat" button.
  leadingActions?: React.ReactNode;
  // Optional working indicator shown before the composer's status in the overlay strip.
  statusLeading?: React.ReactNode;
  // Show the global permission-mode dropdown (Assistant only).
  showPermissionMode?: boolean;
}

const MODE_ICON: Record<AIPermissionMode, (typeof IconNames)[keyof typeof IconNames]> = {
  ask: IconNames.HAND,
  remember: IconNames.HISTORY,
  allow: IconNames.UNLOCK,
};
const MODE_LABEL: Record<AIPermissionMode, string> = {
  ask: "Always ask",
  remember: "Ask and remember",
  allow: "Always allow",
};

const PermissionModeMenu: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const { t } = useTranslation();
  const mode: AIPermissionMode = useAppStore((s) => s.userSettings.ai?.permissionMode) ?? "ask";
  const setGlobalUserSettings = useAppStore((s) => s.setGlobalUserSettings);
  const [open, setOpen] = useState(false);

  const setMode = (next: AIPermissionMode) => {
    setOpen(false);
    const current = useAppStore.getState().userSettings.ai ?? DEFAULT_AI_SETTINGS;
    void setGlobalUserSettings({ ai: { ...current, permissionMode: next } });
  };

  return (
    <PopoverNext
      isOpen={open}
      onInteraction={setOpen}
      usePortal
      placement="top-start"
      disabled={disabled}
      content={
        <Menu className="AIComposerModeMenu">
          <MenuItem
            icon={MODE_ICON.ask}
            text={t("Always ask")}
            label={t("Prompt before every command")}
            active={mode === "ask"}
            onClick={() => setMode("ask")}
          />
          <MenuItem
            icon={MODE_ICON.remember}
            text={t("Ask and remember")}
            label={t("Prompt once, remember the choice")}
            active={mode === "remember"}
            onClick={() => setMode("remember")}
          />
          {/* Always allow is destructive — gate it behind an inline Yes/No confirm. */}
          <ConfirmMenuItem
            icon={MODE_ICON.allow}
            text={t("Always allow")}
            intent={Intent.DANGER}
            title={t(
              "Runs every command and web search with no prompt and no safety floor — only on a machine you fully trust.",
            )}
            onConfirm={() => setMode("allow")}
          />
        </Menu>
      }
    >
      <Button
        className="AIComposerTool"
        variant="minimal"
        size="small"
        icon={MODE_ICON[mode]}
        text={t(MODE_LABEL[mode])}
        intent={mode === "allow" ? Intent.DANGER : Intent.NONE}
        title={t("How the assistant is allowed to run commands")}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      />
    </PopoverNext>
  );
};

export const AIComposer: React.FC<AIComposerProps> = ({
  onSubmit,
  phase = "idle",
  onStop,
  placeholder,
  leadingActions,
  statusLeading,
  showPermissionMode,
}) => {
  const { t } = useTranslation();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  // In-memory command history (quake-style Up/Down recall). historyIndex = null means "editing the live
  // draft"; liveDraftRef stashes that draft while navigating so Down past the newest entry restores it.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const liveDraftRef = useRef("");
  // The ModelPicker owns discovery + persistence; the composer just tracks the live selection for submit
  // and provider validation. Seeded from the saved default provider + its model (the picker fills it in on first
  // discovery when nothing is saved yet).
  const [selection, setSelection] = useState<ModelPickerValue>(() => ({
    providerId: ai.defaultProvider,
    model: ai.providers?.[ai.defaultProvider]?.model ?? "",
  }));

  const active = phase !== "idle" && phase !== "error";
  const canStop = active && !!onStop;
  const acceptsSteering = phase === "model" || phase === "tool" || phase === "interrupting";
  const blocked = phase === "awaiting-approval" || phase === "stopping" || (active && !acceptsSteering);
  // Provider authentication is enforced by the broker; saving/selecting the provider already chose its endpoint.
  const canSubmit = !!selection.model && !blocked && !submitting && draft.trim().length > 0;

  // A settings change made in another mounted composer/settings surface becomes the idle composer's next
  // submission target. Never switch underneath an active task; that operation retains its explicit selection.
  useEffect(() => {
    if (active) return;
    const next = {
      providerId: ai.defaultProvider,
      model: ai.providers?.[ai.defaultProvider]?.model ?? "",
    };
    setSelection((current) =>
      current.providerId === next.providerId && current.model === next.model ? current : next,
    );
  }, [active, ai.defaultProvider, ai.providers]);

  // While the model is producing output, Escape stops it — wherever focus is in the app.
  useEffect(() => {
    if (!canStop) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onStop?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canStop, onStop]);

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    const text = draft.trim();
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await onSubmit(text, { providerId: selection.providerId, model: selection.model });
      setDraft("");
      pushCommand(text);
      setHistoryIndex(null);
      liveDraftRef.current = "";
    } catch (error: any) {
      setSubmitError(error?.message ?? String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const hint = submitError
    ? submitError
    : !selection.model
      ? t("Pick a model to start.")
      : phase === "awaiting-approval"
        ? t("Allow or reject the request above to continue.")
        : phase === "stopping"
          ? t("Stopping after the active tool finishes…")
          : acceptsSteering
            ? t("Send another message to steer the active task.")
            : null;

  return (
    <div className="AIComposer">
      {statusLeading || hint ? (
        <div className="AIComposerStatus">
          {statusLeading}
          {hint ? <div className="AIComposerHint">{hint}</div> : null}
        </div>
      ) : null}
      <TextArea
        className="AIComposerInput"
        fill
        value={draft}
        placeholder={placeholder ?? t("Message… (Enter to send, Shift+Enter for newline)")}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          if (historyIndex !== null) {
            setHistoryIndex(null); // typing exits history navigation; the edited text becomes the live draft
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
            return;
          }
          // Quake-style history recall: Up on the first line steps to older sent messages; Down on the last
          // line steps back toward the live draft. Elsewhere the arrows move the caret as usual.
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const ta = e.currentTarget;
            const hist = commandHistory();
            const onFirstLine = ta.value.slice(0, ta.selectionStart).indexOf("\n") === -1;
            const onLastLine = ta.value.slice(ta.selectionEnd).indexOf("\n") === -1;
            if (e.key === "ArrowUp" && onFirstLine && hist.length > 0) {
              if (historyIndex === null) {
                liveDraftRef.current = draft;
              }
              const { index, value } = navigateHistory(hist, historyIndex, "up", liveDraftRef.current);
              e.preventDefault();
              setHistoryIndex(index);
              setDraft(value);
            } else if (e.key === "ArrowDown" && onLastLine && historyIndex !== null) {
              const { index, value } = navigateHistory(hist, historyIndex, "down", liveDraftRef.current);
              e.preventDefault();
              setHistoryIndex(index);
              setDraft(value);
            }
          }
        }}
      />
      <div className="AIComposerToolbar">
        {leadingActions}
        {showPermissionMode ? <PermissionModeMenu disabled={active} /> : null}
        <ModelPicker value={selection} onChange={setSelection} disabled={active} />
        <span className="AIComposerSpacer" />
        {canStop ? <span className="AIComposerStopHint">{t("Press ESC to stop")}</span> : null}
        {canStop ? (
          <Button
            className="AIComposerAction AIComposerStop"
            size="small"
            intent={Intent.DANGER}
            icon={IconNames.STOP}
            title={t("Stop")}
            aria-label={t("Stop")}
            onClick={onStop}
          />
        ) : null}
        <Button
          className="AIComposerAction AIComposerSend"
          size="small"
          intent={Intent.PRIMARY}
          icon={IconNames.ARROW_UP}
          title={t("Send")}
          aria-label={t("Send")}
          disabled={!canSubmit}
          loading={submitting}
          onClick={() => void submit()}
        />
      </div>
    </div>
  );
};
