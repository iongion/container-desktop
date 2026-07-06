import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";

// Build the website demo "pseudo-player" manifests from the already-captured screenshots. Each engine's
// replays/<engine>.json is a plain ordered list of screenshot frames + titles that demo-replay.js pages
// through with the transport controls. There is no separate recording step: the demo is just a curated
// slideshow of the shots, so writeDemoManifests() runs as the final step of `yarn screenshots`. The frame
// list lives in demoScenario.json; the images come from website-src/static/img/<engine>/*.png.

const ROOT = PROJECT_HOME;
const IMG_DIR = path.join(ROOT, "website-src", "static", "img");
const REPLAYS_DIR = path.join(ROOT, "website-src", "static", "replays");

interface Frame {
  screenshot: string;
  title: string;
}
interface Scenario {
  viewport: { width: number; height: number };
  frameDurationMs: number;
  engines: string[];
  frames: Frame[];
}

const scenario: Scenario = JSON.parse(readFileSync(new URL("./demoScenario.json", import.meta.url), "utf8"));

// Prefer the engine's own capture; fall back to the unified set when an engine folder lacks that shot
// (mirrors theme-switcher.js, so a not-yet-captured engine still gets a complete demo).
function resolveScreenshot(engine: string, file: string): string {
  const folder = existsSync(path.join(IMG_DIR, engine, file)) ? engine : "unified";
  return `/img/${folder}/${file}`;
}

function manifestForEngine(engine: string) {
  return {
    version: 2,
    engine,
    viewport: scenario.viewport,
    frameDurationMs: scenario.frameDurationMs,
    frames: scenario.frames.map((frame) => ({
      screenshot: resolveScreenshot(engine, frame.screenshot),
      title: frame.title,
    })),
  };
}

// Write the demo manifests for the given engines (defaults to all). Called at the end of the screenshot
// run so the manifests always reference freshly captured images.
export function writeDemoManifests(engines: string[] = scenario.engines): string[] {
  const list = scenario.engines.filter((engine) => engines.includes(engine));
  mkdirSync(REPLAYS_DIR, { recursive: true });
  const written: string[] = [];
  for (const engine of list) {
    const outPath = path.join(REPLAYS_DIR, `${engine}.json`);
    writeFileSync(outPath, `${JSON.stringify(manifestForEngine(engine), null, 2)}\n`);
    written.push(outPath);
    console.log(`demo manifest: ${path.relative(ROOT, outPath)} (${scenario.frames.length} frames)`);
  }
  return written;
}
