import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { JsonView } from "./JsonView";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("@/web-app/components/CodeEditor", () => ({
  CodeEditor: () => <div className="CodeEditorMock" />,
}));

describe("JsonView", () => {
  it("uses a mode-specific default title", () => {
    const treeHtml = renderToStaticMarkup(<JsonView value='{"name":"demo"}' />);
    const jsonHtml = renderToStaticMarkup(<JsonView value='{"name":"demo"}' defaultView="json" />);

    expect(treeHtml).toContain("Tree view");
    expect(treeHtml).not.toContain("Raw configuration");
    expect(jsonHtml).toContain("Raw configuration");
  });
});
