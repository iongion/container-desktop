import { describe, expect, it } from "vitest";

import { apiErrorStatus, extractApiErrorText } from "./apiError";

describe("extractApiErrorText", () => {
  it("prefers the Docker/Apple `{ message }` body over the generic axios message", () => {
    const error = {
      message: "Request failed with status code 400",
      response: { status: 400, data: { message: "could not choose an IP address to advertise" } },
    };
    expect(extractApiErrorText(error)).toBe("could not choose an IP address to advertise");
  });

  it("prefers libpod `message` over `cause`", () => {
    const error = {
      response: { status: 500, data: { cause: "already exists", message: "container already in use", response: 500 } },
    };
    expect(extractApiErrorText(error)).toBe("container already in use");
  });

  it("falls back to libpod `cause` when there is no message", () => {
    expect(extractApiErrorText({ response: { data: { cause: "no such volume" } } })).toBe("no such volume");
  });

  it("handles a plain-string body", () => {
    expect(extractApiErrorText({ response: { data: "boom from the daemon" } })).toBe("boom from the daemon");
  });

  it("handles `{ Err }` / `{ error }` shapes", () => {
    expect(extractApiErrorText({ response: { data: { Err: "driver failed" } } })).toBe("driver failed");
    expect(extractApiErrorText({ response: { data: { error: "bad request" } } })).toBe("bad request");
  });

  it("falls back to the axios message when the body carries nothing useful", () => {
    expect(
      extractApiErrorText({ message: "Request failed with status code 400", response: { status: 400, data: {} } }),
    ).toBe("Request failed with status code 400");
  });

  it("uses the provided fallback when nothing is available", () => {
    expect(extractApiErrorText(undefined, "Could not do the thing")).toBe("Could not do the thing");
  });
});

describe("apiErrorStatus", () => {
  it("returns the numeric status", () => {
    expect(apiErrorStatus({ response: { status: 400 } })).toBe(400);
  });

  it("coerces a stringified status (survives IPC re-serialize)", () => {
    expect(apiErrorStatus({ response: { status: "503" } })).toBe(503);
  });

  it("returns undefined when there is no status", () => {
    expect(apiErrorStatus({ message: "boom" })).toBeUndefined();
  });
});
