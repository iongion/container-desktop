import { Icon, type IconName } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  type AssistantCommandExecutionContext,
  planCommandExecution,
} from "@/ai-system/ui/core/commands/commandAvailability";
import type {
  AssistantCommandDefinition,
  AssistantCommandMatch,
  AssistantCommandRegistry,
  AssistantCommandText,
  BuiltinAssistantCommandId,
} from "@/ai-system/ui/core/commands/commandTypes";

interface AssistantCommandPaletteCommands {
  registry: AssistantCommandRegistry;
  context: AssistantCommandExecutionContext;
}

interface AssistantCommandPaletteProps {
  commands: AssistantCommandPaletteCommands;
  matches: readonly AssistantCommandMatch[];
  query: string;
  listboxId: string;
  anchor: "input" | "button";
  selectedIndex: number;
  onSelect: (command: AssistantCommandDefinition) => void;
  onSelectedIndexChange: (index: number) => void;
}

const BUILTIN_COMMAND_ICONS: Record<BuiltinAssistantCommandId, IconName> = {
  help: IconNames.HELP,
  "skills.open": IconNames.LIGHTBULB,
  "skills.reload": IconNames.REFRESH,
  "context.usage": IconNames.TIMELINE_BAR_CHART,
  "context.tools": IconNames.WRENCH,
  "diagnostics.open": IconNames.PULSE,
  "changes.status": IconNames.CHANGES,
  "changes.diff": IconNames.COMPARISON,
  "memory.list": IconNames.BOOK,
  "memory.add": IconNames.ADD,
  "memory.remove": IconNames.TRASH,
  "memory.clear": IconNames.DELETE,
  "rules.list": IconNames.DOCUMENT,
  "rules.init": IconNames.NEW_OBJECT,
  "thread.list": IconNames.HISTORY,
  "thread.new": IconNames.ADD,
  "thread.switch": IconNames.SWAP_HORIZONTAL,
  "thread.rename": IconNames.EDIT,
  "thread.branch": IconNames.GIT_BRANCH,
  "thread.compact": IconNames.COMPRESSED,
  "thread.delete": IconNames.TRASH,
  "thread.stop": IconNames.STOP,
  "thread.copy": IconNames.CLIPBOARD,
  "thread.export": IconNames.EXPORT,
  "model.open": IconNames.MODEL,
  "access.set": IconNames.EYE_OPEN,
  "reasoning.set": IconNames.LIGHTBULB,
  "permissions.open": IconNames.SHIELD,
  "worker.list": IconNames.PEOPLE,
  "worker.show": IconNames.SEARCH,
  "worker.create": IconNames.NEW_PERSON,
  "run.start": IconNames.PLAY,
  "run.list": IconNames.LIST,
  "run.show": IconNames.SEARCH,
  "run.stop": IconNames.STOP,
};

function commandIcon(command: AssistantCommandDefinition): IconName {
  if (command.kind === "control") return BUILTIN_COMMAND_ICONS[command.id];
  switch (command.source.kind) {
    case "bundled-skill":
      return IconNames.LIGHTBULB;
    case "user-skill":
      return IconNames.PERSON;
    case "project-skill":
      return IconNames.PROJECTS;
    case "plugin-skill":
      return IconNames.APPLICATIONS;
  }
}

function HighlightedText({ value, query }: { value: string; query: string }) {
  const normalized = query.trim().toLocaleLowerCase();
  const candidates = [normalized, normalized.replace(/^\/+/, "")].filter((candidate) => candidate.length > 1);
  const lowerValue = value.toLocaleLowerCase();
  const needle = candidates.find((candidate) => lowerValue.includes(candidate));
  if (!needle) return value;
  const start = lowerValue.indexOf(needle);
  return (
    <>
      {value.slice(0, start)}
      <mark>{value.slice(start, start + needle.length)}</mark>
      {value.slice(start + needle.length)}
    </>
  );
}

function commandText(text: AssistantCommandText, t: (key: string) => string): string {
  return text.kind === "i18n" ? t(text.key) : text.value;
}

function commandSource(command: AssistantCommandDefinition, t: (key: string) => string): string {
  switch (command.source.kind) {
    case "builtin":
      return t("Built-in");
    case "bundled-skill":
      return t("Bundled skill");
    case "user-skill":
      return t("User skill");
    case "project-skill":
      return t("Project skill");
    case "plugin-skill":
      return `${t("Plugin skill")} · ${command.source.pluginId}`;
  }
}

export function AssistantCommandPalette({
  commands,
  matches,
  query,
  listboxId,
  anchor,
  selectedIndex,
  onSelect,
  onSelectedIndexChange,
}: AssistantCommandPaletteProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  let previousCategory = "";

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div
      id={listboxId}
      className="AssistantCommandPalette"
      role="listbox"
      aria-label={t("Slash commands")}
      data-command-anchor={anchor}
    >
      <div className="AssistantCommandPaletteHeader">
        <span>{t("Slash commands")}</span>
        <span>{t("{{count}} commands", { count: matches.length })}</span>
      </div>
      <div className="AssistantCommandPaletteList" ref={listRef}>
        {matches.length === 0 ? <div className="AssistantCommandPaletteEmpty">{t("No matching commands")}</div> : null}
        {matches.map(({ command, matchedBy }, index) => {
          const category = commandText(command.category, t);
          const showCategory = category !== previousCategory;
          previousCategory = category;
          const execution = planCommandExecution(command, commands.context);
          const unavailable = execution.kind === "unavailable";
          const matchedAlias = command.aliases.includes(matchedBy as `/${string}`) ? matchedBy : undefined;
          const source = command.kind === "skill" ? commandSource(command, t) : undefined;
          const meta = [matchedAlias ? `${t("Alias")}: ${matchedAlias}` : undefined, source]
            .filter(Boolean)
            .join(" · ");
          return (
            <div key={`${command.source.kind}:${command.id}`} className="AssistantCommandPaletteEntry">
              {showCategory ? <div className="AssistantCommandPaletteCategory">{category}</div> : null}
              <button
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={unavailable}
                id={`${listboxId}-option-${index}`}
                data-command-index={index}
                tabIndex={-1}
                className={`AssistantCommandPaletteRow${index === selectedIndex ? " is-selected" : ""}${
                  unavailable ? " is-unavailable" : ""
                }`}
                onMouseEnter={() => onSelectedIndexChange(index)}
                onClick={() => onSelect(command)}
              >
                <span className="AssistantCommandPaletteIcon">
                  <Icon icon={commandIcon(command)} size={16} />
                </span>
                <span className="AssistantCommandPaletteBody">
                  <span className="AssistantCommandPaletteCommand">
                    <code>
                      <HighlightedText value={command.path} query={query} />
                    </code>
                    {command.argumentHint ? <span>{commandText(command.argumentHint, t)}</span> : null}
                  </span>
                  <span className="AssistantCommandPaletteDescription">
                    <HighlightedText value={commandText(command.description, t)} query={query} />
                  </span>
                  {meta ? <span className="AssistantCommandPaletteMeta">{meta}</span> : null}
                </span>
                {execution.kind === "queue" ? (
                  <span className="AssistantCommandPaletteState">{t("Queues")}</span>
                ) : unavailable ? (
                  <span className="AssistantCommandPaletteState">{t(execution.reasonKey)}</span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
      <div className="AssistantCommandPaletteFooter">
        <span>
          <kbd>↑↓</kbd> {t("Navigate")}
        </span>
        <span>
          <kbd>{t("Enter")}</kbd> {t("Insert")}
        </span>
        <span>
          <kbd>{t("Esc")}</kbd> {t("Close")}
        </span>
      </div>
    </div>
  );
}
