import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("resource detail action menus", () => {
  it("preserves the owning connection on single-view detail menus", () => {
    expect(source("src/web-app/screens/Secret/InspectScreen.tsx")).toContain(
      "rightContent={<SecretActionsMenu secret={secret} connectionId={connectionId} withoutCreate />}",
    );
    expect(source("src/web-app/screens/Volume/InspectScreen.tsx")).toContain(
      "rightContent={<VolumeActionsMenu volume={volume} connectionId={connectionId} withoutCreate />}",
    );
    expect(source("src/web-app/screens/Network/ScreenHeader.tsx")).toContain(
      "rightContent={<ActionsMenu withoutCreate network={network} connectionId={connId} />}",
    );
  });
});
