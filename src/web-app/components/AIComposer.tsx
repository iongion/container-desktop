// Shared AI composer — the ONE way to talk to the AI anywhere in the app. A rounded box
// with a borderless textarea and a footer-minimal toolbar: optional leading actions, an optional
// permission-mode dropdown (Assistant only), the ModelPicker (source → provider → model), and a circular
// send/stop. The composer keeps only the current {providerId, model} for submit, so every
// AI surface (the Assistant and Runs) gets the identical interaction by rendering <AIComposer onSubmit=…/>.
import { Button, Intent, Menu, MenuItem, PopoverNext, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccessProfileId } from "@/ai-system/core/accessProfiles";
import { describeError } from "@/ai-system/core/errors";
import { type ReasoningLevel, reasoningCapability } from "@/ai-system/core/reasoning";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import type { ThreadPhase } from "@/ai-system/core/threadEvents";
import type { AISettings } from "@/ai-system/core/types";
import {
  type AssistantCommandExecutionContext,
  planCommandExecution,
} from "@/ai-system/ui/core/commands/commandAvailability";
import {
  enqueueAssistantCommand,
  type QueuedAssistantCommand,
  removeQueuedAssistantCommand,
  revalidateQueuedAssistantCommand,
} from "@/ai-system/ui/core/commands/commandQueue";
import type {
  AssistantCommandExecutionResult,
  AssistantCommandRegistry,
  AssistantInputParseResult,
} from "@/ai-system/ui/core/commands/commandTypes";
import { parseAssistantInput } from "@/ai-system/ui/core/commands/parseCommand";
import { navigateHistory, pushSubmission, submissionHistory } from "@/ai-system/ui/core/submissionHistory";
import { AssistantCommandPalette } from "@/web-app/components/ai/AssistantCommandPalette";
import {
  AccessProfileMenu,
  ExecutionTargetMenu,
  PermissionModeMenu,
  ReasoningLevelMenu,
} from "@/web-app/components/ai/AssistantComposerControls";
import { useAssistantCommandCompletion } from "@/web-app/hooks/useAssistantCommandCompletion";
import {
  type AssistantThreadBindings,
  useAssistantThreadConfiguration,
} from "@/web-app/hooks/useAssistantThreadConfiguration";
import { useAppStore } from "@/web-app/stores/appStore";

import { ModelPicker, type ModelPickerValue } from "./ModelPicker";

import "./AIComposer.css";

export interface AIComposerContext {
  providerId: string;
  model: string;
  accessProfile: AccessProfileId;
  reasoningLevel: ReasoningLevel;
}

export type ParsedAssistantCommand = Extract<AssistantInputParseResult, { kind: "command" }>;

export interface AIComposerCommands {
  registry: AssistantCommandRegistry;
  context: AssistantCommandExecutionContext;
  threadId: string | null;
  onExecute: (
    command: ParsedAssistantCommand,
  ) => AssistantCommandExecutionResult | Promise<AssistantCommandExecutionResult>;
}

export interface AIComposerProps {
  // Called with the (trimmed, non-empty) text and the chosen provider/model when the user sends.
  onSubmit: (text: string, ctx: AIComposerContext) => unknown | Promise<unknown>;
  phase?: ThreadPhase;
  onStop?: () => Promise<void> | void;
  placeholder?: string;
  // Optional left-aligned toolbar content, e.g. the Assistant's "New Thread" button.
  leadingActions?: React.ReactNode;
  // Optional working indicator shown before the composer's status in the overlay strip.
  statusLeading?: React.ReactNode;
  // Show the global permission-mode dropdown (Assistant only).
  showPermissionMode?: boolean;
  threadBindings?: AssistantThreadBindings;
  commands?: AIComposerCommands;
}

export const AIComposer: React.FC<AIComposerProps> = ({
  onSubmit,
  phase = "idle",
  onStop,
  placeholder,
  leadingActions,
  statusLeading,
  showPermissionMode,
  threadBindings,
  commands,
}) => {
  const { t } = useTranslation();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [accessProfileOpen, setAccessProfileOpen] = useState(false);
  const [reasoningLevelOpen, setReasoningLevelOpen] = useState(false);
  const [queuedCommands, setQueuedCommands] = useState<QueuedAssistantCommand[]>([]);
  const commandListboxId = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const completion = useAssistantCommandCompletion({ registry: commands?.registry, inputRef, setValue: setDraft });
  const queueCounterRef = useRef(0);
  const processingQueueRef = useRef(false);
  // In-memory submission history (quake-style Up/Down recall). historyIndex = null means "editing the live
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
  const threadConfiguration = useAssistantThreadConfiguration(threadBindings, active);
  const { accessProfile, reasoningLevel, pending: configurationPending } = threadConfiguration;

  const updateThreadConfiguration = useCallback(
    async (patch: Parameters<typeof threadConfiguration.update>[0]) => {
      setSubmitError(undefined);
      await threadConfiguration.update(patch);
    },
    [threadConfiguration.update],
  );

  const applyCommandEffect = useCallback(
    async (effect: AssistantCommandExecutionResult) => {
      switch (effect?.kind) {
        case "open-command-palette":
          completion.replaceValue(effect.query ? `/${effect.query.replace(/^\/+/, "")}` : "/");
          break;
        case "open-model-picker":
          setModelPickerOpen(true);
          break;
        case "open-access-profile":
          setAccessProfileOpen(true);
          break;
        case "set-access-profile":
          await updateThreadConfiguration({ accessProfile: effect.value });
          setAccessProfileOpen(false);
          break;
        case "open-reasoning-level":
          setReasoningLevelOpen(true);
          break;
        case "set-reasoning-level":
          if (!reasoningCapability(selection.providerId, selection.model).levels.includes(effect.value)) {
            setSubmitError(t("{{level}} reasoning is unavailable for this model", { level: t(effect.value) }));
            break;
          }
          await updateThreadConfiguration({ reasoningLevel: effect.value });
          setReasoningLevelOpen(false);
          break;
      }
    },
    [completion.replaceValue, selection.model, selection.providerId, t, updateThreadConfiguration],
  );

  const canStop = active && !!onStop;
  const acceptsSteering = phase === "model" || phase === "tool" || phase === "interrupting";
  const blocked = phase === "awaiting-approval" || phase === "stopping" || (active && !acceptsSteering);
  const slashInput = !!commands && draft.trimStart().startsWith("/") && !draft.trimStart().startsWith("//");
  const paletteOpen = completion.open;
  const paletteAnchor = completion.state.anchor;
  const paletteQuery = completion.state.query || "/";
  const commandMatches = completion.matches;
  // Provider authentication is enforced by the broker; saving/selecting the provider already chose its endpoint.
  const canSubmit =
    !submitting &&
    !configurationPending &&
    draft.trim().length > 0 &&
    (slashInput ? !!commands : !!selection.model && !blocked);

  // A settings change made in another mounted composer/settings surface becomes the idle composer's next
  // submission target. Never switch underneath an active task; that operation retains its explicit selection.
  useEffect(() => {
    if (active) return;
    const next = {
      providerId: threadBindings?.providerId ?? ai.defaultProvider,
      model: threadBindings?.model ?? ai.providers?.[threadBindings?.providerId ?? ai.defaultProvider]?.model ?? "",
    };
    setSelection((current) =>
      current.providerId === next.providerId && current.model === next.model ? current : next,
    );
  }, [active, ai.defaultProvider, ai.providers, threadBindings?.providerId, threadBindings?.model]);

  useEffect(() => {
    const entry = queuedCommands[0];
    if (!commands || !entry || processingQueueRef.current) return;
    const execution = revalidateQueuedAssistantCommand(entry, commands.registry, commands.context, commands.threadId);
    if (execution.kind === "queue") return;
    if (execution.kind === "unavailable") {
      setSubmitError(t(execution.reasonKey));
      setQueuedCommands((current) => current.filter(({ queueId }) => queueId !== entry.queueId));
      return;
    }

    processingQueueRef.current = true;
    void Promise.resolve(commands.onExecute(execution.command))
      .then((effect) => applyCommandEffect(effect))
      .catch((error) => setSubmitError(describeError(error)))
      .finally(() => {
        processingQueueRef.current = false;
        setQueuedCommands((current) => current.filter(({ queueId }) => queueId !== entry.queueId));
      });
  }, [applyCommandEffect, commands, queuedCommands, t]);

  useEffect(() => {
    if (!paletteOpen) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [paletteOpen]);

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

  const clearSubmittedDraft = (text: string) => {
    completion.replaceValue("");
    pushSubmission(text);
    setHistoryIndex(null);
    liveDraftRef.current = "";
  };

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    const text = draft.trim();
    const parsed = commands ? parseAssistantInput(text, commands.registry) : ({ kind: "message", text } as const);
    if (parsed.kind === "error") {
      setSubmitError(t(parsed.messageKey));
      completion.replaceValue(draft);
      return;
    }
    if (parsed.kind === "command") {
      const execution = planCommandExecution(parsed.command, commands!.context);
      if (execution.kind === "unavailable") {
        setSubmitError(t(execution.reasonKey));
        return;
      }
      if (execution.kind === "queue") {
        queueCounterRef.current += 1;
        try {
          setQueuedCommands(
            enqueueAssistantCommand(
              queuedCommands,
              queueCounterRef.current,
              parsed,
              commands!.registry,
              commands!.threadId,
              Date.now(),
            ),
          );
        } catch (error) {
          setSubmitError(t(describeError(error)));
          return;
        }
        clearSubmittedDraft(text);
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(undefined);
    try {
      if (parsed.kind === "command") {
        const effect = await commands!.onExecute(parsed);
        if (effect?.kind === "open-command-palette") {
          await applyCommandEffect(effect);
          return;
        }
        clearSubmittedDraft(text);
        await applyCommandEffect(effect);
      } else {
        await onSubmit(parsed.text, {
          providerId: selection.providerId,
          model: selection.model,
          accessProfile,
          reasoningLevel,
        });
        clearSubmittedDraft(text);
      }
    } catch (error) {
      setSubmitError(describeError(error));
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
      <PopoverNext
        className="AIComposerInputCompletionTarget"
        popoverClassName="AIComposerCommandPopover AIComposerCommandPopover--input"
        content={
          commands ? (
            <AssistantCommandPalette
              commands={commands}
              matches={commandMatches}
              query={paletteQuery}
              listboxId={commandListboxId}
              anchor="input"
              selectedIndex={completion.selectedIndex}
              onSelect={(command) => {
                setSubmitError(undefined);
                completion.accept("pointer", command.id);
              }}
              onSelectedIndexChange={completion.selectIndex}
            />
          ) : (
            <span />
          )
        }
        isOpen={!!commands && paletteAnchor === "input"}
        onInteraction={(open) => {
          if (!open && paletteAnchor === "input") completion.dismiss();
        }}
        placement="top-start"
        matchTargetWidth
        usePortal
        hasBackdrop={false}
        autoFocus={false}
        enforceFocus={false}
        shouldReturnFocusOnClose={false}
        disabled={!commands}
      >
        <TextArea
          inputRef={inputRef}
          className="AIComposerInput"
          fill
          value={draft}
          placeholder={placeholder ?? t("Message… (Enter to send, Shift+Enter for newline)")}
          aria-autocomplete={commands ? "list" : undefined}
          aria-controls={commands ? commandListboxId : undefined}
          aria-expanded={commands ? paletteOpen : undefined}
          aria-activedescendant={
            commands && paletteOpen && commandMatches.length > 0
              ? `${commandListboxId}-option-${completion.selectedIndex}`
              : undefined
          }
          onChange={(e) => {
            const next = e.currentTarget.value;
            setDraft(next);
            setSubmitError(undefined);
            completion.inputChanged({
              value: next,
              selectionStart: e.currentTarget.selectionStart,
              selectionEnd: e.currentTarget.selectionEnd,
            });
            if (historyIndex !== null) {
              setHistoryIndex(null); // typing exits history navigation; the edited text becomes the live draft
            }
          }}
          onSelect={(e) =>
            completion.selectionChanged({
              value: e.currentTarget.value,
              selectionStart: e.currentTarget.selectionStart,
              selectionEnd: e.currentTarget.selectionEnd,
            })
          }
          onCompositionStart={completion.compositionStarted}
          onCompositionEnd={(e) =>
            completion.compositionEnded({
              value: e.currentTarget.value,
              selectionStart: e.currentTarget.selectionStart,
              selectionEnd: e.currentTarget.selectionEnd,
            })
          }
          onKeyDown={(e) => {
            if (paletteOpen) {
              if (
                (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown") &&
                commandMatches.length > 0
              ) {
                e.preventDefault();
                const direction = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 5 : -5;
                completion.move(direction);
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                if (commandMatches.length === 0) return;
                e.preventDefault();
                setSubmitError(undefined);
                completion.accept(e.key === "Tab" ? "tab" : "enter");
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                completion.dismiss();
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
              return;
            }
            // Quake-style history recall: Up on the first line steps to older sent messages; Down on the last
            // line steps back toward the live draft. Elsewhere the arrows move the caret as usual.
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              const ta = e.currentTarget;
              const hist = submissionHistory();
              const onFirstLine = ta.value.slice(0, ta.selectionStart).indexOf("\n") === -1;
              const onLastLine = ta.value.slice(ta.selectionEnd).indexOf("\n") === -1;
              if (e.key === "ArrowUp" && onFirstLine && hist.length > 0) {
                if (historyIndex === null) {
                  liveDraftRef.current = draft;
                }
                const { index, value } = navigateHistory(hist, historyIndex, "up", liveDraftRef.current);
                e.preventDefault();
                setHistoryIndex(index);
                completion.replaceValue(value);
              } else if (e.key === "ArrowDown" && onLastLine && historyIndex !== null) {
                const { index, value } = navigateHistory(hist, historyIndex, "down", liveDraftRef.current);
                e.preventDefault();
                setHistoryIndex(index);
                completion.replaceValue(value);
              }
            }
          }}
        />
      </PopoverNext>
      <div className="AIComposerToolbar">
        {leadingActions}
        {commands ? (
          <PopoverNext
            popoverClassName="AIComposerCommandPopover AIComposerCommandPopover--button"
            content={
              <AssistantCommandPalette
                commands={commands}
                matches={commandMatches}
                query={paletteQuery}
                listboxId={commandListboxId}
                anchor="button"
                selectedIndex={completion.selectedIndex}
                onSelect={(command) => {
                  setSubmitError(undefined);
                  completion.accept("pointer", command.id);
                }}
                onSelectedIndexChange={completion.selectIndex}
              />
            }
            isOpen={paletteAnchor === "button"}
            onInteraction={(open) => {
              if (open) completion.openButton();
              else completion.dismiss();
            }}
            placement="top-start"
            usePortal
            hasBackdrop={false}
            autoFocus={false}
            enforceFocus={false}
            shouldReturnFocusOnClose={false}
          >
            <Button
              className="AIComposerTool AIComposerCommandTrigger"
              variant="minimal"
              size="small"
              icon={IconNames.SLASH}
              title={t("Slash commands")}
              aria-label={t("Slash commands")}
              aria-expanded={paletteAnchor === "button"}
            />
          </PopoverNext>
        ) : null}
        {showPermissionMode ? (
          <AccessProfileMenu
            value={accessProfile}
            onChange={(value) =>
              void updateThreadConfiguration({ accessProfile: value }).catch((error) =>
                setSubmitError(describeError(error)),
              )
            }
            disabled={active || configurationPending}
            control={{ open: accessProfileOpen, onOpenChange: setAccessProfileOpen }}
          />
        ) : null}
        {showPermissionMode ? <PermissionModeMenu disabled={active || configurationPending} /> : null}
        {showPermissionMode ? <ExecutionTargetMenu disabled={active || configurationPending} /> : null}
        <ModelPicker
          value={selection}
          onChange={setSelection}
          disabled={active || configurationPending}
          control={{ open: modelPickerOpen, onOpenChange: setModelPickerOpen }}
        />
        {showPermissionMode ? (
          <ReasoningLevelMenu
            providerId={selection.providerId}
            model={selection.model}
            value={reasoningLevel}
            onChange={(value) =>
              void updateThreadConfiguration({ reasoningLevel: value }).catch((error) =>
                setSubmitError(describeError(error)),
              )
            }
            disabled={active || configurationPending}
            control={{ open: reasoningLevelOpen, onOpenChange: setReasoningLevelOpen }}
          />
        ) : null}
        <span className="AIComposerSpacer" />
        {queuedCommands.length > 0 ? (
          <PopoverNext
            placement="top-end"
            usePortal
            content={
              <Menu className="AIComposerCommandQueue" aria-label={t("Queued commands")}>
                {queuedCommands.map(({ queueId, canonicalInput }) => (
                  <MenuItem
                    key={queueId}
                    icon={IconNames.TIME}
                    text={canonicalInput}
                    label={t("Cancel")}
                    title={t("Cancel queued command")}
                    onClick={() => setQueuedCommands((current) => removeQueuedAssistantCommand(current, queueId))}
                  />
                ))}
                <MenuItem
                  icon={IconNames.CROSS}
                  text={t("Cancel all queued commands")}
                  onClick={() => setQueuedCommands([])}
                />
              </Menu>
            }
          >
            <Button
              className="AIComposerTool AIComposerQueuedCommands"
              variant="minimal"
              size="small"
              icon={IconNames.TIME}
              text={t("{{count}} queued", { count: queuedCommands.length })}
              title={t("Queued commands")}
            />
          </PopoverNext>
        ) : null}
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
