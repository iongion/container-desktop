import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_ASSISTANT_COMMAND_REGISTRY } from "@/ai-system/ui/core/commands/commandCatalog";
import { renderAssistantCommandCatalogue } from "@/ai-system/ui/core/commands/commandCatalogue";

describe("Assistant command catalogue", () => {
  it("keeps the developer document derived from the runtime registry", () => {
    const document = readFileSync("docs/architecture/assistant-commands.md", "utf8");

    expect(document).toBe(renderAssistantCommandCatalogue(BUILTIN_ASSISTANT_COMMAND_REGISTRY));
  });
});
