#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_HOME = path.dirname(__dirname);
const ICONS_DIR = path.join(PROJECT_HOME, "src/resources/icons");
const CDP = process.env.CDP_URL || "http://localhost:9222";
const CHROME_PATH = process.env.CHROME_PATH || (fs.existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : "");
const TEMPLATE_PATH = path.join(ICONS_DIR, "appIcon-duotone-unified.svg");
const OUTPUT_SIZE = 96;

const engines = {
  docker: {
    bright: "#6fb2ff",
    accent: "#2f7df0",
    strong: "#1d56b8",
  },
  podman: {
    bright: "#d98fe8",
    accent: "#a855c9",
    strong: "#7b3398",
  },
  unified: {
    bright: "#2dd4bf",
    accent: "#14b8a6",
    strong: "#0d9488",
  },
};

// Recolor the three stacked-layers tones (bright / accent / deep) from the unified template per engine.
function appIconSvg(engine) {
  const colors = engines[engine];
  return fs
    .readFileSync(TEMPLATE_PATH, "utf8")
    .replaceAll("#2dd4bf", colors.bright)
    .replaceAll("#14b8a6", colors.accent)
    .replaceAll("#0d9488", colors.strong);
}

async function renderPng(page, svg, pngPath) {
  try {
    await page.evaluate(
      ({ source, size }) => {
        const html = document.documentElement;
        const body = document.body;
        html.dataset.engineIconPreviousBackground = html.style.background;
        body.dataset.engineIconPreviousBackground = body.style.background;
        html.style.background = "transparent";
        body.style.background = "transparent";
        let root = document.getElementById("engine-icon-render-root");
        if (!root) {
          root = document.createElement("div");
          root.id = "engine-icon-render-root";
          body.append(root);
        }
        for (const child of Array.from(body.children)) {
          if (child === root) {
            continue;
          }
          child.dataset.engineIconPreviousVisibility = child.style.visibility;
          child.style.visibility = "hidden";
        }
        root.setAttribute(
          "style",
          `position:fixed;inset:0 auto auto 0;width:${size}px;height:${size}px;z-index:2147483647;background:transparent;overflow:hidden;`,
        );
        root.innerHTML = source.replace(/<\?xml[^>]*>\s*/, "");
        const rendered = root.querySelector("svg");
        rendered?.setAttribute("width", `${size}`);
        rendered?.setAttribute("height", `${size}`);
        if (rendered instanceof SVGSVGElement) {
          rendered.style.display = "block";
        }
      },
      { source: svg, size: OUTPUT_SIZE },
    );
    await page.screenshot({
      path: pngPath,
      omitBackground: true,
      clip: { x: 0, y: 0, width: OUTPUT_SIZE, height: OUTPUT_SIZE },
    });
  } finally {
    await page
      .evaluate(() => {
        const root = document.getElementById("engine-icon-render-root");
        for (const child of Array.from(document.body.children)) {
          if (child === root) {
            continue;
          }
          child.style.visibility = child.dataset.engineIconPreviousVisibility ?? "";
          delete child.dataset.engineIconPreviousVisibility;
        }
        root?.remove();
        document.documentElement.style.background =
          document.documentElement.dataset.engineIconPreviousBackground ?? "";
        document.body.style.background = document.body.dataset.engineIconPreviousBackground ?? "";
        delete document.documentElement.dataset.engineIconPreviousBackground;
        delete document.body.dataset.engineIconPreviousBackground;
      })
      .catch(() => {});
  }
}

async function main() {
  const browser = CHROME_PATH
    ? await chromium.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ["--no-sandbox"],
      })
    : await chromium.connectOverCDP(CDP);
  const context = await browser.newContext({
    viewport: { width: OUTPUT_SIZE, height: OUTPUT_SIZE },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const engine of Object.keys(engines)) {
    const svg = appIconSvg(engine);
    const svgPath = path.join(ICONS_DIR, `appIcon-${engine}.svg`);
    const pngPath = path.join(ICONS_DIR, `appIcon-${engine}.png`);
    fs.writeFileSync(svgPath, svg);
    await renderPng(page, svg, pngPath);
    console.log(`wrote ${path.relative(PROJECT_HOME, svgPath)}`);
    console.log(`wrote ${path.relative(PROJECT_HOME, pngPath)}`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
