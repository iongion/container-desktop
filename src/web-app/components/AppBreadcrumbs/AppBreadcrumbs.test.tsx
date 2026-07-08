import { IconNames } from "@blueprintjs/icons";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppBreadcrumbs } from "./AppBreadcrumbs";
import { crumb, rootCrumb } from "./crumbs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("AppBreadcrumbs", () => {
  it("renders the root breadcrumb icon and leaves non-root crumbs text-only", () => {
    const html = renderToStaticMarkup(
      <AppBreadcrumbs
        items={[rootCrumb("containers", "c1"), crumb({ text: "nginx", icon: IconNames.BOX, current: true })]}
      />,
    );

    expect(html).toContain('data-icon="cube"');
    expect(html).not.toContain('data-icon="box"');
    expect(html).toContain("Containers");
    expect(html).toContain("nginx");
  });
});
