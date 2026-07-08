// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Compose interpolation fixtures intentionally use literal ${VAR} syntax.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadComposeProject } from "./loadComposeProject";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "compose-load-"));
  await writeFile(join(dir, ".env"), "TAG=1.9\n");
  await writeFile(join(dir, "app.env"), "SHARED=file\nONLY=fromfile\n");
  await writeFile(
    join(dir, "docker-compose.yml"),
    "services:\n  web:\n    image: nginx:${TAG}\n    env_file: app.env\n    environment:\n      SHARED: inline\n",
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadComposeProject", () => {
  it("loads from raw text with an explicit dir (name derived from the dir)", async () => {
    const model = await loadComposeProject({ text: "services:\n  web:\n    image: nginx", dir: "/somewhere/proj" });
    expect(model.services[0].image).toBe("nginx");
    expect(model.projectDir).toBe("/somewhere/proj");
    expect(model.name).toBe("proj");
  });

  it("reads the file, applies .env interpolation and merges env_file (inline wins)", async () => {
    const model = await loadComposeProject({ path: join(dir, "docker-compose.yml") });
    const web = model.services[0];
    expect(web.image).toBe("nginx:1.9");
    expect(web.environment).toEqual({ SHARED: "inline", ONLY: "fromfile" });
    expect(model.projectDir).toBe(dir);
  });

  it("honors an explicit project name override", async () => {
    const model = await loadComposeProject({ text: "services: {}", dir: "/x/y", projectName: "My App" });
    expect(model.name).toBe("my-app");
  });

  it("propagates schema validation errors", async () => {
    await expect(loadComposeProject({ text: "services: 123" })).rejects.toThrow();
  });
});
