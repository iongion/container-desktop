import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import {
  type AssistantCommandCompletionActor,
  type AssistantCommandCompletionEvent,
  type AssistantCommandCompletionInput,
  type AssistantCommandCompletionMethod,
  type AssistantCommandCompletionState,
  applyAssistantCommandCompletionEdit,
  createAssistantCommandCompletionActor,
} from "@/ai-system/ui/core/commands/commandCompletionController";
import type { AssistantCommandId, AssistantCommandRegistry } from "@/ai-system/ui/core/commands/commandTypes";

interface UseAssistantCommandCompletionParams {
  registry?: AssistantCommandRegistry;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  setValue: (value: string) => void;
}

function inputSnapshot(input: HTMLTextAreaElement | null): AssistantCommandCompletionInput {
  return input
    ? { value: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd }
    : { value: "", selectionStart: 0, selectionEnd: 0 };
}

const EMPTY_COMPLETION_STATE: AssistantCommandCompletionState = {
  phase: "closed",
  query: "",
  composing: false,
  registryRevision: "",
};

const emptySnapshot = (): AssistantCommandCompletionState => EMPTY_COMPLETION_STATE;
const emptySubscribe = () => () => undefined;

export function useAssistantCommandCompletion({ registry, inputRef, setValue }: UseAssistantCommandCompletionParams) {
  const actorRef = useRef<AssistantCommandCompletionActor | undefined>(undefined);
  if (!actorRef.current && registry) actorRef.current = createAssistantCommandCompletionActor(registry);
  const actor = actorRef.current;
  const state = useSyncExternalStore(actor?.subscribe ?? emptySubscribe, actor?.getSnapshot ?? emptySnapshot);
  const pendingEditRef = useRef<{ value: string; start: number; end: number } | undefined>(undefined);

  const dispatch = useCallback(
    (event: AssistantCommandCompletionEvent) => {
      if (!registry || !actor) return undefined;
      return actor.send(event);
    },
    [actor, registry],
  );

  useLayoutEffect(() => {
    if (registry && actor && actor.getSnapshot().registryRevision !== registry.revision) {
      actor.send({ type: "registry-changed", registry });
    }
  }, [actor, registry]);

  useLayoutEffect(() => {
    const pending = pendingEditRef.current;
    if (!pending) return;
    const input = inputRef.current;
    if (input?.value === pending.value) {
      input.focus();
      input.setSelectionRange(pending.start, pending.end);
    }
  });

  const projection = actor?.project() ?? { matches: [], selectedCommandId: undefined, selectedIndex: 0 };

  const accept = useCallback(
    (method: AssistantCommandCompletionMethod, commandId?: AssistantCommandId) => {
      const snapshot = inputSnapshot(inputRef.current);
      const result = dispatch({ type: "accept", input: snapshot, method, commandId });
      if (!result?.edit) return false;
      const edit = applyAssistantCommandCompletionEdit(snapshot.value, result.edit);
      pendingEditRef.current = { value: edit.value, start: edit.selectionStart, end: edit.selectionEnd };
      setValue(edit.value);
      return true;
    },
    [dispatch, inputRef, setValue],
  );

  const replaceValue = useCallback(
    (value: string) => {
      const selection = { start: value.length, end: value.length };
      pendingEditRef.current = { value, ...selection };
      setValue(value);
      dispatch({
        type: "input-changed",
        input: { value, selectionStart: selection.start, selectionEnd: selection.end },
      });
    },
    [dispatch, setValue],
  );

  const selectionChanged = useCallback(
    (input: AssistantCommandCompletionInput) => {
      const pending = pendingEditRef.current;
      if (pending) {
        if (
          input.value !== pending.value ||
          (input.selectionStart === pending.start && input.selectionEnd === pending.end)
        ) {
          return;
        }
        pendingEditRef.current = undefined;
      }
      dispatch({ type: "selection-changed", input });
    },
    [dispatch],
  );

  const inputChanged = useCallback(
    (input: AssistantCommandCompletionInput) => {
      const pending = pendingEditRef.current;
      if (pending?.value === input.value) return;
      pendingEditRef.current = undefined;
      dispatch({ type: "input-changed", input });
    },
    [dispatch],
  );

  return {
    state,
    matches: projection.matches,
    selectedIndex: projection.selectedIndex,
    open: state.phase === "suggesting",
    inputChanged,
    selectionChanged,
    compositionStarted: () => {
      pendingEditRef.current = undefined;
      return dispatch({ type: "composition-started" });
    },
    compositionEnded: (input: AssistantCommandCompletionInput) => dispatch({ type: "composition-ended", input }),
    openButton: () => dispatch({ type: "open-button", input: inputSnapshot(inputRef.current) }),
    dismiss: () => dispatch({ type: "dismiss" }),
    move: (delta: number) => dispatch({ type: "move", delta }),
    selectIndex: (index: number) => {
      const commandId = projection.matches[index]?.command.id;
      if (commandId) dispatch({ type: "select", commandId });
    },
    accept,
    replaceValue,
  };
}
