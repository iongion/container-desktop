// Shared AI composer — the ONE way to talk to the AI anywhere in the app. A rounded box
// with a borderless textarea and a footer-minimal toolbar: optional leading actions, an optional
// permission-mode dropdown (Assistant only), the ModelPicker (source → provider → model), and a circular
// send/stop. The composer keeps only the current {providerId, model} for submit + egress gating, so every
// screen (Assistant, Generator) gets the identical interaction by rendering <AIComposer onSubmit=…/>.
import { Button, Intent, Menu, MenuItem, PopoverNext, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AIPermissionMode } from "@/ai-system/core";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core";
import type { AISettings } from "@/env/Types";
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
  onSubmit: (text: string, ctx: AIComposerContext) => void;
  streaming?: boolean;
  // When provided AND streaming, the send button becomes a stop button.
  onStop?: () => void;
  placeholder?: string;
  // Optional left-aligned toolbar content, e.g. the Assistant's "New chat" button.
  leadingActions?: React.ReactNode;
  // Show the global permission-mode dropdown (Assistant only — Generator runs no tools).
  showPermissionMode?: boolean;
  // The assistant is waiting on the user's decision for a surfaced action — block send to avoid interleaving.
  awaitingResponse?: boolean;
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

const PermissionModeMenu: React.FC = () => {
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
      />
    </PopoverNext>
  );
};

export const AIComposer: React.FC<AIComposerProps> = ({
  onSubmit,
  streaming,
  onStop,
  placeholder,
  leadingActions,
  showPermissionMode,
  awaitingResponse,
}) => {
  const { t } = useTranslation();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;

  const [draft, setDraft] = useState("");
  // The ModelPicker owns discovery + persistence; the composer just tracks the live selection for submit
  // and egress gating. Seeded from the saved default provider + its model (the picker fills it in on first
  // discovery when nothing is saved yet).
  const [selection, setSelection] = useState<ModelPickerValue>(() => ({
    providerId: ai.defaultProvider,
    model: ai.providers?.[ai.defaultProvider]?.model ?? "",
  }));

  const canStop = !!streaming && !!onStop;
  // Send is gated like a dialog turn: you cannot send while the model is producing output, nor while it
  // is waiting on your decision for a surfaced action — that would interleave with the in-flight turn.
  const blocked = !!streaming || !!awaitingResponse;
  // Cloud consent is the saved API key, enforced in main: a keyless cloud provider surfaces the broker's
  // "no API key stored" error (and the picker shows a NO_KEY note), so the composer only needs a model.
  const canSubmit = !!selection.model && !blocked && draft.trim().length > 0;

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

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    const text = draft;
    setDraft("");
    onSubmit(text, { providerId: selection.providerId, model: selection.model });
  };

  const hint = !selection.model
    ? t("Pick a model to start.")
    : awaitingResponse
      ? t("Allow or reject the request above to continue.")
      : null;

  return (
    <div className="AIComposer">
      {hint ? <div className="AIComposerHint">{hint}</div> : null}
      <TextArea
        className="AIComposerInput"
        fill
        value={draft}
        placeholder={placeholder ?? t("Message… (Enter to send, Shift+Enter for newline)")}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="AIComposerToolbar">
        {leadingActions}
        {showPermissionMode ? <PermissionModeMenu /> : null}
        <ModelPicker value={selection} onChange={setSelection} />
        <span className="AIComposerSpacer" />
        {canStop ? (
          <>
            <span className="AIComposerStopHint">{t("Press ESC to stop")}</span>
            <Button
              className="AIComposerSend"
              size="small"
              intent={Intent.DANGER}
              icon={IconNames.STOP}
              title={t("Stop")}
              aria-label={t("Stop")}
              onClick={onStop}
            />
          </>
        ) : (
          <Button
            className="AIComposerSend"
            size="small"
            intent={Intent.PRIMARY}
            icon={IconNames.ARROW_UP}
            title={t("Send")}
            aria-label={t("Send")}
            disabled={!canSubmit}
            onClick={submit}
          />
        )}
      </div>
    </div>
  );
};
