import { describe, expect, it } from "vitest";
import { expandHome } from "./index";

describe("expandHome", () => {
  it("expands a leading ~ to the home dir", () => {
    expect(expandHome("~/.ssh/id_ed25519", "/home/ion")).toBe("/home/ion/.ssh/id_ed25519");
  });

  it("expands a bare ~", () => {
    expect(expandHome("~", "/home/ion")).toBe("/home/ion");
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/etc/ssh/key", "/home/ion")).toBe("/etc/ssh/key");
  });

  it("expands $HOME (the executor also accepts this form)", () => {
    expect(expandHome("$HOME/.ssh/id_ed25519", "/home/ion")).toBe("/home/ion/.ssh/id_ed25519");
  });

  it("leaves empty input unchanged", () => {
    expect(expandHome("", "/home/ion")).toBe("");
  });
});
