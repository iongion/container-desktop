// Shared AI composer — the ONE way to talk to the AI anywhere in the app. A rounded box
// with a borderless textarea and a footer-minimal toolbar: optional leading actions, an optional
// permission-mode dropdown (Assistant only), the ModelPicker (source → provider → model), and a circular
// send/stop. The composer keeps only the current {providerId, model} for submit, so every
// AI surface (the Assistant and Runs) gets the identical interaction by rendering <AIComposer onSubmit=…/>.
import { Button, Intent, Menu, MenuItem, PopoverNext, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/ai-system/core/errors";
import type { SessionPhase } from "@/ai-system/core/sessionEvents";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
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
import { ExecutionTargetMenu, PermissionModeMenu } from "@/web-app/components/ai/AssistantComposerControls";
import { useAssistantCommandCompletion } from "@/web-app/hooks/useAssistantCommandCompletion";
import { useAppStore } from "@/web-app/stores/appStore";

import { ModelPicker, type ModelPickerValue } from "./ModelPicker";

import "./AIComposer.css";

export interface AIComposerContext {
  providerId: string;
  model: string;
}

export type ParsedAssistantCommand = Extract<AssistantInputParseResult, { kind: "command" }>;

export interface AIComposerCommands {
  registry: AssistantCommandRegistry;
  context: AssistantCommandExecutionContext;
  sessionId: string | null;
  onExecute: (
    command: ParsedAssistantCommand,
  ) => AssistantCommandExecutionResult | Promise<AssistantCommandExecutionResult>;
}

export interface AIComposerProps {
  // Called with the (trimmed, non-empty) text and the chosen provider/model when the user sends.
  onSubmit: (text: string, ctx: AIComposerContext) => unknown | Promise<unknown>;
  phase?: SessionPhase;
  onStop?: () => Promise<void> | void;
  placeholder?: string;
  // Optional left-aligned toolbar content, e.g. the Assistant's "New Session" button.
  leadingActions?: React.ReactNode;
  // Optional working indicator shown before the composer's status in the overlay strip.
  statusLeading?: React.ReactNode;
  // Show the global permission-mode dropdown (Assistant only).
  showPermissionMode?: boolean;
  commands?: AIComposerCommands;
  // A draft an extension pushed in (pi's setEditorText). The seq is what makes it applicable twice: setting
  // the same text again is a new instruction, not a no-op.
  draft?: { text: string; seq: number };
  // The model a RUNNING session is answering with, and how to re-point it. Present where the composer sits in front
  // of one: the chip then shows what is actually answering and a pick switches that session in place, instead of
  // saving a default the next session would pick up. Absent ⇒ the chip is the saved selection, as everywhere else.
  session?: {
    providerId: string;
    model: string;
    onSelectModel: (modelId: string, providerId: string) => Promise<void>;
  };
}

export const AIComposer: React.FC<AIComposerProps> = ({
  onSubmit,
  phase = "idle",
  onStop,
  placeholder,
  leadingActions,
  statusLeading,
  showPermissionMode,
  commands,
  draft: injectedDraft,
  session,
}) => {
  const { t } = useTranslation();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
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
  // In front of a live session the session IS the selection: its model is what answers, and the saved default
  // describes the next session rather than this one.
  const target: ModelPickerValue = session ? { providerId: session.providerId, model: session.model } : selection;
  const active = phase !== "idle" && phase !== "error";

  const applyCommandEffect = useCallback(
    (effect: AssistantCommandExecutionResult) => {
      switch (effect?.kind) {
        case "open-command-palette":
          completion.replaceValue(effect.query ? `/${effect.query.replace(/^\/+/, "")}` : "/");
          break;
        case "open-model-picker":
          setModelPickerOpen(true);
          break;
      }
    },
    [completion.replaceValue],
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
  const canSubmit = !submitting && draft.trim().length > 0 && (slashInput ? !!commands : !!target.model && !blocked);

  // Picking a model. In front of a live session that re-points the session itself, in place — a refusal (another
  // inference source, a model the provider does not serve) is the session's own words, shown like any other hint.
  const pickModel = useCallback(
    (next: ModelPickerValue) => {
      if (!session) {
        setSelection(next);
        return;
      }
      setSubmitError(undefined);
      void session.onSelectModel(next.model, next.providerId).catch((error) => setSubmitError(describeError(error)));
    },
    [session],
  );

  // A settings change made in another mounted composer/settings surface becomes the idle composer's next
  // submission target. Never switch underneath an active task; that operation retains its explicit selection.
  // Nothing to track while a session owns the selection: it answers for what is running.
  useEffect(() => {
    if (active || session) return;
    const next = {
      providerId: ai.defaultProvider,
      model: ai.providers?.[ai.defaultProvider]?.model ?? "",
    };
    setSelection((current) =>
      current.providerId === next.providerId && current.model === next.model ? current : next,
    );
  }, [active, session, ai.defaultProvider, ai.providers]);

  // An extension replacing the composer text. The store hands over a fresh object per push — its `seq` is what
  // keeps two identical texts distinct — so applying on identity lands both without reverting live typing.
  useEffect(() => {
    if (!injectedDraft) return;
    setDraft(injectedDraft.text);
    setHistoryIndex(null);
  }, [injectedDraft]);

  useEffect(() => {
    const entry = queuedCommands[0];
    if (!commands || !entry || processingQueueRef.current) return;
    const execution = revalidateQueuedAssistantCommand(entry, commands.registry, commands.context, commands.sessionId);
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
              commands!.sessionId,
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
          applyCommandEffect(effect);
          return;
        }
        clearSubmittedDraft(text);
        applyCommandEffect(effect);
      } else {
        await onSubmit(parsed.text, { providerId: target.providerId, model: target.model });
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
    : !target.model
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
        {showPermissionMode ? <PermissionModeMenu disabled={active} /> : null}
        {showPermissionMode ? <ExecutionTargetMenu disabled={active} /> : null}
        <ModelPicker
          value={target}
          onChange={pickModel}
          disabled={active}
          control={{ open: modelPickerOpen, onOpenChange: setModelPickerOpen }}
          autoSelect={!session}
        />
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
