import { describe, expect, it } from "vitest";

import { parseEnvFile } from "./envfile";

describe("compose parseEnvFile", () => {
  it("parses KEY=VALUE lines into a record", () => {
    expect(parseEnvFile("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("ignores blank lines and # comments", () => {
    expect(parseEnvFile("# header\n\nA=1\n   # indented comment\nB=2\n")).toEqual({ A: "1", B: "2" });
  });

  it("treats KEY= as an empty value", () => {
    expect(parseEnvFile("EMPTY=")).toEqual({ EMPTY: "" });
  });

  it("keeps everything after the first = (values may contain =)", () => {
    expect(parseEnvFile("DSN=postgres://u:p@h/db?a=b")).toEqual({ DSN: "postgres://u:p@h/db?a=b" });
  });

  it("strips matching surrounding single or double quotes", () => {
    expect(parseEnvFile("A=\"hello world\"\nB='x y'")).toEqual({ A: "hello world", B: "x y" });
  });

  it("trims whitespace around key and unquoted value", () => {
    expect(parseEnvFile("  KEY  =  value  ")).toEqual({ KEY: "value" });
  });

  it("ignores lines without an = sign", () => {
    expect(parseEnvFile("NOT_A_PAIR\nA=1")).toEqual({ A: "1" });
  });
});
