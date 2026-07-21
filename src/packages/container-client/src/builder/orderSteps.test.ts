import { describe, expect, it } from "vitest";

import { orderBuildSteps } from "./orderSteps";
import type { BuildStep } from "./types";

const step = (name: string): BuildStep => ({ key: name, index: 0, name, status: "done", cached: false, logs: [] });

describe("orderBuildSteps", () => {
  it("orders buildx DAG-emitted steps by Containerfile step number ([N/M]); internal first, export last", () => {
    // buildx --progress=rawjson emits vertices target-first, so the numbered steps arrive descending.
    const emitted = [
      step("[internal] load build definition"),
      step("[5/5] COPY . ."),
      step("[4/5] RUN npm ci"),
      step("[3/5] COPY pkg"),
      step("[internal] load build context"),
      step("[2/5] WORKDIR /app"),
      step("[1/5] FROM node"),
      step("exporting to image"),
    ];
    expect(orderBuildSteps(emitted).map((s) => s.name)).toEqual([
      "[internal] load build definition",
      "[internal] load build context",
      "[1/5] FROM node",
      "[2/5] WORKDIR /app",
      "[3/5] COPY pkg",
      "[4/5] RUN npm ci",
      "[5/5] COPY . .",
      "exporting to image",
    ]);
  });

  it("keeps bare-name steps (podman) in first-seen order", () => {
    const ordered = [step("FROM node"), step("WORKDIR /app"), step("RUN npm ci")];
    expect(orderBuildSteps(ordered).map((s) => s.name)).toEqual(["FROM node", "WORKDIR /app", "RUN npm ci"]);
  });

  it("is stable for steps sharing a bucket", () => {
    const prep = [step("[internal] load a"), step("[internal] load b")];
    expect(orderBuildSteps(prep).map((s) => s.name)).toEqual(["[internal] load a", "[internal] load b"]);
  });
});
