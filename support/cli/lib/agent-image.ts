import { cp, mkdir, rename } from "node:fs/promises";
import path from "node:path";

export function agentImageBuildArgv(options: { tag: string; contextDir: string; dockerfile: string }): string[] {
  return ["build", "--tag", options.tag, "--file", options.dockerfile, options.contextDir];
}

// Dev reads the staged context from the repo. A packaged app has to pass `override`, because neither
// shell ships it yet: Tauri would need a `bundle.resources` entry plus a resource-directory helper on the
// platform ports, and Wails its own asset mechanism. Keeping this explicit stops the packaged path from
// silently resolving to a directory that does not exist.
export function resolveAgentImageContext(options: { repoRoot: string; override?: string }): string {
  return options.override ?? path.posix.join(options.repoRoot, "build/agent-image");
}

// pi and its runtime-loaded friends stay EXTERNAL: pi loads extensions through jiti at runtime, so it
// must be resolved from the image's own node_modules, not inlined into this bundle.
export async function bundleAgentHost(options: { root: string; outDir: string }): Promise<string> {
  // esbuild is imported lazily: its module init asserts a TextEncoder invariant that jsdom breaks, so a
  // top-level import would make this module unloadable in the hermetic test environment.
  const { build } = await import("esbuild");
  const outfile = path.join(options.outDir, "host.mjs");
  await mkdir(options.outDir, { recursive: true });
  await build({
    // TWO entries, not one: the conversation store's socket is owned by a worker thread, and a worker needs a file of
    // its own to be spawned from. The main bundle resolves it as a sibling (`./session-storage-worker.mjs`), so the
    // two must land in the same directory — which is why they are emitted by one build rather than two.
    entryPoints: [
      path.join(options.root, "src/packages/pi-agent-host/src/main.ts"),
      path.join(options.root, "src/packages/pi-agent-host/src/sessionStorageWorker.ts"),
    ],
    outdir: options.outDir,
    entryNames: "[name]",
    // `main` and `sessionStorageWorker` are what esbuild would name them; the image expects `host.mjs` beside
    // `session-storage-worker.mjs`, so both are renamed after the build.
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    // The subpath is named as well as the package: the login mode imports `pi-ai/providers/all`, and only an
    // explicit entry guarantees esbuild leaves it alone instead of following it into the generated catalogue.
    external: [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-ai/providers/all",
      "@earendil-works/pi-tui",
      "jiti",
      "ws",
    ],
    // The container tools' descriptions are model-facing prose kept in markdown; esbuild inlines it as a string,
    // which is this bundler's equivalent of the renderer's `?raw` suffix.
    loader: { ".md": "text" },
    alias: {
      "@/pi-agent-host": path.join(options.root, "src/packages/pi-agent-host/src"),
      "@/pi-bridge": path.join(options.root, "src/packages/pi-bridge/src"),
      "@/logger": path.join(options.root, "src/packages/logger/src"),
      "@/template": path.join(options.root, "src/packages/template/src"),
      "@/resources": path.join(options.root, "src/resources"),
    },
  });
  // esbuild names an output after its entry, and the image's names are its own. Renamed rather than configured with a
  // per-entry `entryNames`, which esbuild does not offer.
  await rename(path.join(options.outDir, "main.mjs"), outfile);
  await rename(
    path.join(options.outDir, "sessionStorageWorker.mjs"),
    path.join(options.outDir, "session-storage-worker.mjs"),
  );
  await cp(path.join(options.root, "support/agent-image/Dockerfile"), path.join(options.outDir, "Dockerfile"));
  // pi's session store compiled with a storage port, which the image copies over the published files. Part of the build
  // CONTEXT rather than the bundle: it replaces files inside pi's own package, where esbuild has no say.
  await cp(path.join(options.root, "support/agent-image/pi-patch"), path.join(options.outDir, "pi-patch"), {
    recursive: true,
  });
  return outfile;
}
