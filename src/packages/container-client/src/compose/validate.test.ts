import { describe, expect, it } from "vitest";

import { ComposeValidationError, validateComposeSpec } from "./validate";

describe("compose validateComposeSpec", () => {
  it("accepts a minimal valid compose object", () => {
    expect(() => validateComposeSpec({ services: { web: { image: "nginx" } } })).not.toThrow();
  });

  it("accepts services with ports, volumes, networks and depends_on", () => {
    const doc = {
      services: {
        web: {
          image: "nginx",
          ports: ["8080:80"],
          volumes: ["./html:/usr/share/nginx/html:ro"],
          depends_on: ["db"],
        },
        db: { image: "postgres:16", environment: { POSTGRES_PASSWORD: "x" } },
      },
      networks: { default: {} },
      volumes: { data: {} },
    };
    expect(() => validateComposeSpec(doc)).not.toThrow();
  });

  it("rejects services declared as a non-object", () => {
    expect(() => validateComposeSpec({ services: 123 })).toThrow(ComposeValidationError);
  });

  it("reports the offending path in the error message", () => {
    let message = "";
    try {
      validateComposeSpec({ services: { web: { image: 123 } } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/image/);
  });
});
