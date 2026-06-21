import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createCredentialsFs } from "./credentialsStore";

async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), "cd-ai-cred-"));
  return join(dir, "ai-credentials.json");
}

describe("createCredentialsFs", () => {
  it("round-trips JSON content", async () => {
    const fs = createCredentialsFs(await tempFile());
    await fs.write({ openai: "Y2lwaGVy" });
    expect(await fs.read()).toEqual({ openai: "Y2lwaGVy" });
  });

  it("returns {} when the file does not exist", async () => {
    expect(await createCredentialsFs(await tempFile()).read()).toEqual({});
  });

  it("hardens a pre-existing world-readable file to 0600 on every write", async () => {
    const file = await tempFile();
    // A prior version (or external tool) may have left it loose; mode-on-create alone won't fix it.
    await writeFile(file, "{}");
    await chmod(file, 0o644);
    expect((await stat(file)).mode & 0o777).toBe(0o644);

    await createCredentialsFs(file).write({ anthropic: "Y2lwaGVy" });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
