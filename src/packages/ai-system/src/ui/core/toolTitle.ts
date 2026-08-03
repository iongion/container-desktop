import { piToolSummary, resolvePiCardKind } from "@/ai-system/core/piToolCards";
import { getContainerToolPresentation, type ToolPresentation } from "@/ai-system/core/toolNames";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const OTHER_TOOLS: Readonly<Record<string, ToolPresentation>> = {
  searchKnowledge: { titleKey: "Search knowledge" },
  webSearch: { titleKey: "Web search" },
};

function commandTitle(args: Record<string, unknown>, t: Translate): string {
  const program = typeof args.program === "string" ? args.program : "";
  const commandArgs = Array.isArray(args.args) ? args.args.map(String) : [];
  return `${program} ${commandArgs.join(" ")}`.trim() || t("Run command");
}

function renderTitle(spec: ToolPresentation, args: Record<string, unknown>, t: Translate): string {
  const value = String(args[spec.argument ?? ""] ?? "");
  const options = {
    ...(spec.argument ? { [spec.argument]: spec.argument === "id" ? value.slice(0, 12) : value } : {}),
    ...(spec.labelKey ? { label: t(spec.labelKey) } : {}),
  };
  const title = t(spec.titleKey, options);
  const connectionId = typeof args.connectionId === "string" ? args.connectionId.trim() : "";
  return spec.showConnection && connectionId ? `${title} (${connectionId})` : title;
}

export function toolTitle(tool: string, args: Record<string, unknown>, t: Translate, fallback = tool): string {
  if (tool === "runCommand") return commandTitle(args, t);
  // pi's built-ins are named for what they do ("bash", "read"), so the title is the call itself — the command
  // or the path — and stays untranslated for the same reason a shell command is.
  if (resolvePiCardKind(tool)) return piToolSummary(tool, args);
  const spec = getContainerToolPresentation(tool) ?? OTHER_TOOLS[tool];
  return spec ? renderTitle(spec, args, t) : fallback;
}
