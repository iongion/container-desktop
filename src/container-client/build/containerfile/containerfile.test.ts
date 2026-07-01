import { describe, expect, it } from "vitest";
import { lint } from "./lint";
import { parse } from "./parse";
import { serialize } from "./serialize";

const SRC = `# syntax=docker/dockerfile:1
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci \\
    --omit=dev
COPY . .
RUN <<EOF
echo "building"
npm run build
EOF

# Runtime stage
FROM nginx:latest
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
`;

describe("containerfile parse + serialize", () => {
  it("round-trips multi-stage + here-doc + continuation + comments + # syntax= exactly", () => {
    expect(serialize(parse(SRC))).toBe(SRC);
  });

  it("splits stages on FROM and records stage names + flags", () => {
    const ast = parse(SRC);
    expect(ast.stages.length).toBe(2);
    expect(ast.stages[0].name).toBe("builder");
    const copyFrom = ast.instructions.find((i) => i.instruction === "COPY" && i.flags.from);
    expect(copyFrom?.flags.from).toBe("builder");
  });
});

describe("containerfile lint", () => {
  it("flags :latest on FROM as CF002", () => {
    const findings = lint(parse("FROM node:latest\n"));
    expect(findings.some((f) => f.ruleId === "CF002")).toBe(true);
  });

  it("flags apt-get install without cleanup as CF003", () => {
    const findings = lint(parse("FROM ubuntu:22.04\nRUN apt-get update && apt-get install -y curl\n"));
    expect(findings.some((f) => f.ruleId === "CF003")).toBe(true);
  });

  it("does not flag CF003 when the same RUN cleans the apt lists", () => {
    const src = "FROM ubuntu:22.04\nRUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*\n";
    const findings = lint(parse(src));
    expect(findings.some((f) => f.ruleId === "CF003")).toBe(false);
  });

  it("flags an unknown instruction keyword as CF005", () => {
    const findings = lint(parse("FROM alpine\nFOOBAR x\n"));
    expect(findings.some((f) => f.ruleId === "CF005")).toBe(true);
  });

  it("flags COPY . . before a dependency install as a cache-buster (CF007)", () => {
    const src = "FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm install\n";
    const findings = lint(parse(src));
    expect(findings.some((f) => f.ruleId === "CF007")).toBe(true);
  });
});
