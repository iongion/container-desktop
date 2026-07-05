import { readFileSync } from "node:fs";

export const demoScenario = JSON.parse(readFileSync(new URL("./demoScenario.json", import.meta.url), "utf8"));
