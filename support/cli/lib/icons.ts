import fs from "node:fs";
import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { spawnArgs } from "@/cli/lib/process";

// Rasterize the vector master (support/resources/appIcon-source.svg) into the full icon set via
// external CLI tools (resvg / svgo / png2icons / ImageMagick). Port of support/create-icons.py; run
// with `yarn cli create-icons` (full set) or `yarn cli create-icons --appx` (Store tiles only).

const SOURCE_PATH = path.join(PROJECT_HOME, "support/resources/appIcon-source.svg");
const SOURCE_MONOCHROME_PATH = path.join(PROJECT_HOME, "support/resources/appIcon-monochrome.svg");
const SIZES = [16, 32, 48, 64, 71, 96, 128, 150, 300, 180, 192, 256, 512, 1024];
const SQUARE_SIZES = [30, 44, 71, 89, 107, 142, 150, 284, 300, 310];
const ICO_SIZES = [16, 32, 48, 128, 256];
const OUTPUT_PATH = path.join(PROJECT_HOME, "temp/icons");
const APPX_PATH = path.join(PROJECT_HOME, "src/resources/appx");

// Windows Store (appx/MSIX) tiles + logos, keyed by on-disk name -> pixel size, rendered straight
// into src/resources/appx from the same vector master as every other icon.
const APPX_SQUARES: Record<string, number> = {
  "Square44x44Logo.png": 44,
  "StoreLogo.png": 50,
  "71x71.png": 71,
  "SmallTile.png": 71,
  "150x150.png": 150,
  "Square150x150Logo.png": 150,
  "300x300.png": 300,
  "LargeTile.png": 310,
};

const isWindows = process.platform === "win32";
const SVGO = isWindows ? "svgo.cmd" : "svgo";
const PNG2ICONS = isWindows ? "png2icons.cmd" : "png2icons";

function generateIcon(size = 16): void {
  const exportPath = path.join(OUTPUT_PATH, `${size}x${size}.png`);
  spawnArgs("resvg", ["--width", String(size), "--height", String(size), SOURCE_PATH, exportPath]);
  if (size > 16) {
    const half = Math.floor(size / 2);
    const export2x = path.join(OUTPUT_PATH, `${half}x${half}@2x.png`);
    spawnArgs("resvg", ["--width", String(half), "--height", String(half), SOURCE_PATH, export2x]);
  }
}

function generateSquare(size: number, outputName?: string): void {
  const exportPath = path.join(OUTPUT_PATH, outputName ?? `Square${size}x${size}Logo.png`);
  spawnArgs("resvg", ["--width", String(size), "--height", String(size), SOURCE_PATH, exportPath]);
}

function generatePlain(): void {
  const exportPath = path.join(OUTPUT_PATH, "icon.svg");
  spawnArgs(SVGO, [SOURCE_PATH, "-o", exportPath]);
}

function generateTray(size = 64, monochrome = false): void {
  const exportPath = path.join(OUTPUT_PATH, "trayIcon.png");
  const source = monochrome ? SOURCE_MONOCHROME_PATH : SOURCE_PATH;
  if (fs.existsSync(exportPath)) {
    console.log(`resvg tray ${exportPath} - skip`);
    return;
  }
  spawnArgs("resvg", ["--width", String(size), "--height", String(size), source, exportPath]);
}

function generateIcns(): void {
  const exportPath = path.join(OUTPUT_PATH, "icon");
  const importPath = path.join(OUTPUT_PATH, "512x512.png");
  spawnArgs(PNG2ICONS, [importPath, exportPath, "-allp", "-bc", "-i"]);
}

function generateIco(): void {
  const exportPath = path.join(OUTPUT_PATH, "icon.ico");
  const inputs = ICO_SIZES.map((size) => path.join(OUTPUT_PATH, `${size}x${size}.png`));
  spawnArgs("magick", [...inputs, "-colors", "512", exportPath]);
}

function generateAppxSquare(size: number, outputName: string): void {
  const exportPath = path.join(APPX_PATH, outputName);
  spawnArgs("resvg", ["--width", String(size), "--height", String(size), SOURCE_PATH, exportPath]);
}

function generateAppxWide(width = 310, height = 150, mark = 130): void {
  // resvg only rasterizes the square viewBox, so render the mark and letterbox it onto a
  // transparent width x height canvas to keep the wide tile centered.
  const exportPath = path.join(APPX_PATH, "Wide310x150Logo.png");
  const markPath = path.join(APPX_PATH, "_wide-mark.png");
  spawnArgs("resvg", ["--width", String(mark), "--height", String(mark), SOURCE_PATH, markPath]);
  spawnArgs("magick", [
    markPath,
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    `${width}x${height}`,
    "-strip",
    exportPath,
  ]);
  fs.rmSync(markPath, { force: true });
}

export function generateAppx(): void {
  fs.mkdirSync(APPX_PATH, { recursive: true });
  for (const [outputName, size] of Object.entries(APPX_SQUARES)) {
    generateAppxSquare(size, outputName);
  }
  generateAppxWide();
}

export function generateIcons(): void {
  fs.mkdirSync(path.join(OUTPUT_PATH, "icons"), { recursive: true });
  fs.mkdirSync(path.join(PROJECT_HOME, "src/resources/icons"), { recursive: true });
  for (const size of SIZES) {
    generateIcon(size);
  }
  for (const size of SQUARE_SIZES) {
    generateSquare(size);
  }
  generateSquare(50, "StoreLogo.png");
  generateAppx();
  generatePlain();
  generateTray(64, true);
  generateIcns();
  generateIco();
}

export function createIcons(options: { appx?: boolean } = {}): void {
  if (options.appx) {
    generateAppx();
  } else {
    generateIcons();
  }
}
