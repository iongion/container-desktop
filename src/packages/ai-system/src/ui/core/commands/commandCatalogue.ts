import type { AssistantCommandRegistry, AssistantCommandText } from "./commandTypes";

function textValue(text: AssistantCommandText | undefined): string {
  if (!text) return "—";
  return text.kind === "i18n" ? text.key : text.value;
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderAssistantCommandCatalogue(registry: AssistantCommandRegistry): string {
  const rows = registry.commands.map((command) => {
    const aliases = command.aliases.length > 0 ? command.aliases.map((alias) => `\`${alias}\``).join(", ") : "—";
    return `| \`${command.path}\` | ${aliases} | ${cell(textValue(command.description))} | ${cell(textValue(command.argumentHint))} | \`${command.bypassTier}\` | \`${command.availabilityId}\` | \`${command.confirmation}\` |`;
  });
  return [
    "# Assistant command catalogue",
    "",
    "<!-- Generated from commandCatalog.ts. Update the registry, then regenerate this document. -->",
    "",
    `Registry revision: \`${registry.revision}\``,
    "",
    "| Command | Aliases | Description | Arguments | Bypass tier | Availability | Confirmation |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
