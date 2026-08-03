import { createMachine, guard, interpret, type Transition as RobotTransition, reduce, state, transition } from "robot3";
import type {
  AssistantCommandDefinition,
  AssistantCommandId,
  AssistantCommandMatch,
  AssistantCommandRegistry,
} from "./commandTypes";
import { completeCommands } from "./completeCommand";

export type AssistantCommandCompletionAnchor = "input" | "button";
export type AssistantCommandCompletionPhase = "closed" | "suggesting" | "arguments" | "composing";
export type AssistantCommandCompletionMethod = "enter" | "tab" | "pointer";

export interface AssistantCommandCompletionInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface AssistantCommandCompletionRange {
  start: number;
  end: number;
}

export interface AssistantCommandCompletionTrigger extends AssistantCommandCompletionRange {
  text: string;
  identity: string;
}

export interface AssistantCommandCompletionState {
  phase: AssistantCommandCompletionPhase;
  anchor?: AssistantCommandCompletionAnchor;
  trigger?: AssistantCommandCompletionTrigger;
  query: string;
  selectedCommandId?: AssistantCommandId;
  dismissedTriggerIdentity?: string;
  composing: boolean;
  registryRevision: string;
}

export interface AssistantCommandCompletionEdit {
  commandId: AssistantCommandId;
  range: AssistantCommandCompletionRange;
  text: string;
  selection: AssistantCommandCompletionRange;
  method: AssistantCommandCompletionMethod;
}

export interface AssistantCommandCompletionProjection {
  matches: AssistantCommandMatch[];
  selectedCommandId?: AssistantCommandId;
  selectedIndex: number;
}

export type AssistantCommandCompletionEvent =
  | { type: "input-changed" | "selection-changed"; input: AssistantCommandCompletionInput }
  | { type: "composition-started" }
  | { type: "composition-ended"; input: AssistantCommandCompletionInput }
  | { type: "open-button"; input: AssistantCommandCompletionInput }
  | { type: "dismiss" }
  | { type: "registry-changed"; registry?: AssistantCommandRegistry }
  | { type: "move"; delta: number }
  | { type: "select"; commandId: AssistantCommandId }
  | {
      type: "accept";
      input: AssistantCommandCompletionInput;
      method: AssistantCommandCompletionMethod;
      commandId?: AssistantCommandId;
    };

export interface AssistantCommandCompletionTransition {
  state: AssistantCommandCompletionState;
  edit?: AssistantCommandCompletionEdit;
}

interface InputAnalysis {
  phase: "suggesting" | "arguments";
  trigger: AssistantCommandCompletionTrigger;
  query: string;
  commandId?: AssistantCommandId;
}

interface AssistantCommandCompletionMachineContext {
  registry: AssistantCommandRegistry;
  anchor?: AssistantCommandCompletionAnchor;
  trigger?: AssistantCommandCompletionTrigger;
  query: string;
  selectedCommandId?: AssistantCommandId;
  dismissedTriggerIdentity?: string;
}

type AnalyzedInputEvent = Extract<
  AssistantCommandCompletionEvent,
  { type: "input-changed" | "selection-changed" | "composition-ended" }
> & { analysis?: InputAnalysis };

type RegistryChangedEvent = Extract<AssistantCommandCompletionEvent, { type: "registry-changed" }> & {
  registry: AssistantCommandRegistry;
};

type OpenButtonEvent = Extract<AssistantCommandCompletionEvent, { type: "open-button" }> & {
  analysis?: InputAnalysis;
};

interface AcceptedCommand {
  command: AssistantCommandDefinition;
  edit: AssistantCommandCompletionEdit;
}

type AcceptEvent = Extract<AssistantCommandCompletionEvent, { type: "accept" }> & {
  accepted?: AcceptedCommand;
};

type AssistantCommandCompletionMachineEvent =
  | Exclude<
      AssistantCommandCompletionEvent,
      | { type: "input-changed" | "selection-changed" | "composition-ended" }
      | { type: "registry-changed" }
      | { type: "open-button" }
      | { type: "accept" }
    >
  | AnalyzedInputEvent
  | RegistryChangedEvent
  | OpenButtonEvent
  | AcceptEvent;

type AssistantCommandCompletionMachineEventType = AssistantCommandCompletionMachineEvent["type"];
type AssistantCommandCompletionMachineTransition = RobotTransition<AssistantCommandCompletionMachineEventType>;

function machineTransition<F extends string>(value: RobotTransition<F>): AssistantCommandCompletionMachineTransition {
  return value as unknown as AssistantCommandCompletionMachineTransition;
}

function triggerIdentity(start: number, end: number, text: string): string {
  return `${start}:${end}:${text}`;
}

function normalizedCommandText(value: string): string {
  return value.trimEnd().toLocaleLowerCase().replace(/\s+/g, " ");
}

function inputAnalysis(
  input: AssistantCommandCompletionInput,
  registry: AssistantCommandRegistry,
): InputAnalysis | undefined {
  if (input.selectionStart !== input.selectionEnd) return undefined;
  const start = input.value.match(/^\s*/)?.[0].length ?? 0;
  const end = input.selectionStart;
  if (end <= start || input.value[start] !== "/" || input.value[start + 1] === "/") return undefined;
  const text = input.value.slice(start, end);
  if (text.includes("\n") || text.includes("\r")) return undefined;

  const trigger = { start, end, text, identity: triggerIdentity(start, end, text) };
  const normalized = normalizedCommandText(text);
  const argumentEntry = [...registry.lookup]
    .filter(({ command }) => command.arguments.kind !== "none")
    .sort((left, right) => right.name.length - left.name.length)
    .find(({ name }) => normalized.startsWith(`${name} `));
  if (argumentEntry) {
    return { phase: "arguments", trigger, query: text, commandId: argumentEntry.command.id };
  }
  return { phase: "suggesting", trigger, query: text };
}

function completionEdit(
  command: AssistantCommandDefinition,
  trigger: AssistantCommandCompletionTrigger,
  method: AssistantCommandCompletionMethod,
): AssistantCommandCompletionEdit {
  const text = `${command.path}${command.arguments.kind === "none" ? "" : " "}`;
  const caret = trigger.start + text.length;
  return {
    commandId: command.id,
    range: { start: trigger.start, end: trigger.end },
    text,
    selection: { start: caret, end: caret },
    method,
  };
}

function machineClosedContext(
  context: AssistantCommandCompletionMachineContext,
  dismissedTriggerIdentity = context.dismissedTriggerIdentity,
): AssistantCommandCompletionMachineContext {
  return {
    registry: context.registry,
    query: "",
    dismissedTriggerIdentity,
  };
}

function machineSuggestionContext(
  context: AssistantCommandCompletionMachineContext,
  analysis: InputAnalysis,
  anchor: AssistantCommandCompletionAnchor,
): AssistantCommandCompletionMachineContext {
  const matches = completeCommands(analysis.query, context.registry);
  return {
    ...context,
    anchor,
    trigger: analysis.trigger,
    query: analysis.query,
    selectedCommandId: matches.some(({ command }) => command.id === context.selectedCommandId)
      ? context.selectedCommandId
      : matches[0]?.command.id,
  };
}

function machineArgumentContext(
  context: AssistantCommandCompletionMachineContext,
  analysis: InputAnalysis,
): AssistantCommandCompletionMachineContext {
  return {
    ...context,
    anchor: undefined,
    trigger: analysis.trigger,
    query: analysis.query,
    selectedCommandId: analysis.commandId,
    dismissedTriggerIdentity: undefined,
  };
}

function isSuggestionEvent(context: AssistantCommandCompletionMachineContext, event: AnalyzedInputEvent): boolean {
  return event.analysis?.phase === "suggesting" && event.analysis.trigger.identity !== context.dismissedTriggerIdentity;
}

function isArgumentEvent(_context: AssistantCommandCompletionMachineContext, event: AnalyzedInputEvent): boolean {
  return event.analysis?.phase === "arguments";
}

function reduceSuggestionInput(
  context: AssistantCommandCompletionMachineContext,
  event: AnalyzedInputEvent,
): AssistantCommandCompletionMachineContext {
  return machineSuggestionContext(context, event.analysis!, "input");
}

function reduceArgumentInput(
  context: AssistantCommandCompletionMachineContext,
  event: AnalyzedInputEvent,
): AssistantCommandCompletionMachineContext {
  return machineArgumentContext(context, event.analysis!);
}

function reduceClosedInput(
  context: AssistantCommandCompletionMachineContext,
  event: AnalyzedInputEvent,
): AssistantCommandCompletionMachineContext {
  const identity = event.analysis?.trigger.identity;
  return machineClosedContext(context, identity === context.dismissedTriggerIdentity ? identity : undefined);
}

function analyzedInputTransitions(type: AnalyzedInputEvent["type"]) {
  return [
    machineTransition(transition(type, "suggesting", guard(isSuggestionEvent), reduce(reduceSuggestionInput))),
    machineTransition(transition(type, "arguments", guard(isArgumentEvent), reduce(reduceArgumentInput))),
    machineTransition(transition(type, "closed", reduce(reduceClosedInput))),
  ];
}

function openButtonContext(
  context: AssistantCommandCompletionMachineContext,
  event: OpenButtonEvent,
): AssistantCommandCompletionMachineContext {
  const analysis = event.analysis?.phase === "suggesting" ? event.analysis : undefined;
  const trigger =
    analysis?.trigger ??
    ({
      start: 0,
      end: event.input.value.length,
      text: event.input.value,
      identity: triggerIdentity(0, event.input.value.length, event.input.value),
    } satisfies AssistantCommandCompletionTrigger);
  return machineSuggestionContext(context, { phase: "suggesting", trigger, query: analysis?.query ?? "/" }, "button");
}

function moveSelection(
  context: AssistantCommandCompletionMachineContext,
  event: Extract<AssistantCommandCompletionEvent, { type: "move" }>,
): AssistantCommandCompletionMachineContext {
  const matches = completeCommands(context.query, context.registry);
  if (matches.length === 0) return context;
  const currentIndex = Math.max(
    0,
    matches.findIndex(({ command }) => command.id === context.selectedCommandId),
  );
  const nextIndex = (((currentIndex + event.delta) % matches.length) + matches.length) % matches.length;
  return { ...context, selectedCommandId: matches[nextIndex].command.id };
}

function selectCommand(
  context: AssistantCommandCompletionMachineContext,
  event: Extract<AssistantCommandCompletionEvent, { type: "select" }>,
): AssistantCommandCompletionMachineContext {
  return completeCommands(context.query, context.registry).some(({ command }) => command.id === event.commandId)
    ? { ...context, selectedCommandId: event.commandId }
    : context;
}

function hasAcceptedArguments(_context: AssistantCommandCompletionMachineContext, event: AcceptEvent): boolean {
  return !!event.accepted && event.accepted.command.arguments.kind !== "none";
}

function hasAcceptedCommand(_context: AssistantCommandCompletionMachineContext, event: AcceptEvent): boolean {
  return !!event.accepted;
}

function acceptCommand(
  context: AssistantCommandCompletionMachineContext,
  event: AcceptEvent,
): AssistantCommandCompletionMachineContext {
  const accepted = event.accepted!;
  const identity = triggerIdentity(context.trigger!.start, accepted.edit.selection.end, accepted.edit.text);
  return {
    ...context,
    anchor: undefined,
    trigger: {
      ...context.trigger!,
      end: accepted.edit.selection.end,
      text: accepted.edit.text,
      identity,
    },
    query: accepted.edit.text,
    selectedCommandId: accepted.command.id,
    dismissedTriggerIdentity: accepted.command.arguments.kind === "none" ? identity : undefined,
  };
}

function dismissSuggestion(
  context: AssistantCommandCompletionMachineContext,
): AssistantCommandCompletionMachineContext {
  return machineClosedContext(
    context,
    context.anchor === "input" ? context.trigger?.identity : context.dismissedTriggerIdentity,
  );
}

function replaceRegistry(
  context: AssistantCommandCompletionMachineContext,
  event: RegistryChangedEvent,
): AssistantCommandCompletionMachineContext {
  return { ...context, registry: event.registry };
}

function reconcileSuggestion(
  context: AssistantCommandCompletionMachineContext,
  event: RegistryChangedEvent,
): AssistantCommandCompletionMachineContext {
  const revised = replaceRegistry(context, event);
  if (!revised.trigger || !revised.anchor) return machineClosedContext(revised);
  return machineSuggestionContext(
    revised,
    { phase: "suggesting", trigger: revised.trigger, query: revised.query },
    revised.anchor,
  );
}

function selectedCommandExists(
  context: AssistantCommandCompletionMachineContext,
  event: RegistryChangedEvent,
): boolean {
  return !!context.selectedCommandId && event.registry.commands.some(({ id }) => id === context.selectedCommandId);
}

const openButtonTransition = machineTransition(transition("open-button", "suggesting", reduce(openButtonContext)));
const compositionStartedTransition = machineTransition(transition("composition-started", "composing"));
const registryClosedTransition = machineTransition(transition("registry-changed", "closed", reduce(replaceRegistry)));

const assistantCommandCompletionMachine = createMachine(
  "closed",
  {
    closed: state(
      ...analyzedInputTransitions("input-changed"),
      ...analyzedInputTransitions("selection-changed"),
      openButtonTransition,
      compositionStartedTransition,
      registryClosedTransition,
      machineTransition(transition("dismiss", "closed")),
    ),
    suggesting: state(
      ...analyzedInputTransitions("input-changed"),
      ...analyzedInputTransitions("selection-changed"),
      machineTransition(transition("move", "suggesting", reduce(moveSelection))),
      machineTransition(transition("select", "suggesting", reduce(selectCommand))),
      machineTransition(transition("accept", "arguments", guard(hasAcceptedArguments), reduce(acceptCommand))),
      machineTransition(transition("accept", "closed", guard(hasAcceptedCommand), reduce(acceptCommand))),
      machineTransition(transition("dismiss", "closed", reduce(dismissSuggestion))),
      openButtonTransition,
      compositionStartedTransition,
      machineTransition(transition("registry-changed", "suggesting", reduce(reconcileSuggestion))),
    ),
    arguments: state(
      ...analyzedInputTransitions("input-changed"),
      ...analyzedInputTransitions("selection-changed"),
      openButtonTransition,
      compositionStartedTransition,
      machineTransition(
        transition("registry-changed", "arguments", guard(selectedCommandExists), reduce(replaceRegistry)),
      ),
      registryClosedTransition,
      machineTransition(transition("dismiss", "closed", reduce(machineClosedContext))),
    ),
    composing: state(
      ...analyzedInputTransitions("composition-ended"),
      machineTransition(transition("registry-changed", "composing", reduce(replaceRegistry))),
      machineTransition(transition("dismiss", "closed", reduce(machineClosedContext))),
    ),
  },
  (context: AssistantCommandCompletionMachineContext) => context,
);

function machineSnapshot(
  phase: string,
  context: AssistantCommandCompletionMachineContext,
): AssistantCommandCompletionState {
  return {
    phase: phase as AssistantCommandCompletionPhase,
    anchor: context.anchor,
    trigger: context.trigger,
    query: context.query,
    selectedCommandId: context.selectedCommandId,
    dismissedTriggerIdentity: context.dismissedTriggerIdentity,
    composing: phase === "composing",
    registryRevision: context.registry.revision,
  };
}

function machineProjection(
  phase: string,
  context: AssistantCommandCompletionMachineContext,
): AssistantCommandCompletionProjection {
  const matches = phase === "suggesting" ? completeCommands(context.query, context.registry) : [];
  const selectedIndex = matches.findIndex(({ command }) => command.id === context.selectedCommandId);
  return {
    matches,
    selectedCommandId: selectedIndex >= 0 ? context.selectedCommandId : matches[0]?.command.id,
    selectedIndex: Math.max(0, selectedIndex),
  };
}

function prepareMachineEvent(
  phase: string,
  context: AssistantCommandCompletionMachineContext,
  event: AssistantCommandCompletionEvent,
): AssistantCommandCompletionMachineEvent {
  if (event.type === "input-changed" || event.type === "selection-changed" || event.type === "composition-ended") {
    return { ...event, analysis: inputAnalysis(event.input, context.registry) };
  }
  if (event.type === "registry-changed") return { ...event, registry: event.registry ?? context.registry };
  if (event.type === "open-button") {
    return { ...event, analysis: inputAnalysis(event.input, context.registry) };
  }
  if (event.type === "accept" && phase === "suggesting" && context.trigger) {
    const projection = machineProjection(phase, context);
    const commandId = event.commandId ?? projection.selectedCommandId;
    const command = projection.matches.find((match) => match.command.id === commandId)?.command;
    return command
      ? { ...event, accepted: { command, edit: completionEdit(command, context.trigger, event.method) } }
      : event;
  }
  return event;
}

export interface AssistantCommandCompletionActor {
  getSnapshot: () => AssistantCommandCompletionState;
  project: () => AssistantCommandCompletionProjection;
  send: (event: AssistantCommandCompletionEvent) => AssistantCommandCompletionTransition;
  subscribe: (listener: (state: AssistantCommandCompletionState) => void) => () => void;
}

export function createAssistantCommandCompletionActor(
  registry: AssistantCommandRegistry,
): AssistantCommandCompletionActor {
  const listeners = new Set<(state: AssistantCommandCompletionState) => void>();
  let snapshot: AssistantCommandCompletionState;
  const service = interpret(
    assistantCommandCompletionMachine,
    (current) => {
      snapshot = machineSnapshot(String(current.machine.current), current.context);
      for (const listener of listeners) listener(snapshot);
    },
    { registry, query: "" },
  );
  snapshot = machineSnapshot(String(service.machine.current), service.context);

  return {
    getSnapshot: () => snapshot,
    project: () => machineProjection(String(service.machine.current), service.context),
    send: (event) => {
      const prepared = prepareMachineEvent(String(service.machine.current), service.context, event);
      service.send(prepared);
      return { state: snapshot, edit: prepared.type === "accept" ? prepared.accepted?.edit : undefined };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function applyAssistantCommandCompletionEdit(
  value: string,
  edit: AssistantCommandCompletionEdit,
): { value: string; selectionStart: number; selectionEnd: number } {
  const start = Math.max(0, Math.min(edit.range.start, value.length));
  const end = Math.max(start, Math.min(edit.range.end, value.length));
  const nextValue = `${value.slice(0, start)}${edit.text}${value.slice(end)}`;
  return {
    value: nextValue,
    selectionStart: Math.max(0, Math.min(edit.selection.start, nextValue.length)),
    selectionEnd: Math.max(0, Math.min(edit.selection.end, nextValue.length)),
  };
}
