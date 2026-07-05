import { Command } from "commander";
import {
  createIcons,
  fetchAppx,
  installSelfSignedAppx,
  publishMeta,
  runAuditShared,
  runBuild,
  runBuildWebsite,
  runBump,
  runBundle,
  runChecksums,
  runClean,
  runCommitRelease,
  runGenerateEngineIcons,
  runPrepare,
  runPublishRelease,
  runRelease,
  runStart,
  runUpdateDemoReplay,
  runUpdateScreenshots,
  runVersionSync,
  uninstallSelfSignedAppx,
} from "@/cli/commands";
import { readSourceVersion } from "@/cli/lib/paths";

// Home-grown build/dev/release CLI (commander), replacing the Python invoke tasks. Run via tsx:
//   yarn cli <command>    (or: tsx support/cli/index.ts <command>)
// One subcommand per former invoke task; names are preserved.

const program = new Command();

program
  .name("cli")
  .description("Container Desktop build, dev and release tooling")
  .version(readSourceVersion(), "-v, --version", "Print the source version (package.json)");

program.command("clean").description("Remove node_modules, bin, build and release").action(runClean);

program.command("prepare").description("Install Node dependencies (yarn --frozen-lockfile)").action(runPrepare);

program
  .command("build")
  .description("Build the app and co-locate icons in build/<version>/")
  .action(() => runBuild());

program
  .command("bundle")
  .description("Package installers for TARGET (local, or a remote box for cross-OS builds)")
  .action(async () => {
    await runBundle();
  });

program
  .command("release")
  .description("Bundle then checksum the installers with production env")
  .action(async () => {
    await runRelease();
  });

program
  .command("bump")
  .description("Bump package.json + synced files, promote the CHANGELOG, optionally commit/tag/push")
  .option("--part <part>", "major | minor | patch", "patch")
  .option("--perform", "write files (otherwise dry-run)", false)
  .option("--no-commit", "write bumped files but skip git")
  .action((options) => {
    runBump({ part: options.part, perform: options.perform, commit: options.commit });
  });

program
  .command("commit-release")
  .description("Commit an already-bumped release (stage all, tag, push) without re-bumping")
  .action(runCommitRelease);

program
  .command("version-sync")
  .description("Write the source version into all synced files (drift repair, no bump)")
  .option("--version <version>", "version to sync (defaults to package.json)")
  .option("--perform", "write files (otherwise dry-run)", false)
  .action((options) => {
    runVersionSync({ version: options.version, perform: options.perform });
  });

program
  .command("publish-release")
  .description("Create/update the GitHub release from local artifacts (dry-run by default)")
  .option("--version <version>", "release version (defaults to package.json)")
  .option("--run-id <id>", "download artifacts from one or more Actions runs first")
  .option("--title <title>", "release title (defaults to the version)")
  .option("--perform", "actually create/update the release", false)
  .option("--clobber", "replace already-uploaded assets when the release exists", false)
  .option("--replace", "delete and recreate the release, keeping the tag", false)
  .action((options) => {
    runPublishRelease(options);
  });

program
  .command("publish-meta")
  .description("Render website + homebrew cask for a published release (defaults to latest)")
  .option("--version <version>", "published version (defaults to the latest release)")
  .option("--perform", "write files (otherwise dry-run)", false)
  .action(async (options) => {
    await publishMeta({ version: options.version, perform: options.perform });
  });

program
  .command("fetch-appx")
  .description("Download the Microsoft Store package from a CDPipeline run and verify it")
  .option("--run-id <id>", "target a specific run (defaults to newest non-expired)")
  .option("--version <version>", "assert the fetched build matches this version")
  .option("--arch <arch>", "x64 | arm64", "x64")
  .option("--keep", "keep the raw download dir for inspection", false)
  .action((options) => {
    fetchAppx(options);
  });

program
  .command("update-demo-replay")
  .description("Regenerate the website rrweb demo replay")
  .option("--backend <backend>", "electron | tauri (defaults to CONTAINER_DESKTOP_CAPTURE_BACKEND, else electron)")
  .option("--engine <engines>", "comma-separated engines to record (podman,docker,unified)")
  .option("--mode <mode>", "dev | built", "dev")
  .option("--kill-stray", "kill orphaned capture apps/drivers first", false)
  .action((options) => runUpdateDemoReplay(options));

program
  .command("update-screenshots")
  .description("Regenerate deterministic website screenshots")
  .option("--backend <backend>", "electron | tauri (defaults to CONTAINER_DESKTOP_CAPTURE_BACKEND, else electron)")
  .option("--engine <engines>", "comma-separated engines to capture (podman,docker,unified)")
  .option("--only <files>", "comma-separated screenshot filenames to capture")
  .option("--mode <mode>", "dev | built", "dev")
  .option("--clean", "prune stale files + wipe engine folders first (full runs only)", false)
  .option("--kill-stray", "kill orphaned capture apps/drivers first", false)
  .action((options) => runUpdateScreenshots(options));

program.command("start").description("Run the app in development (yarn dev)").action(runStart);

program.command("build-website").description("Compile website-src/ into website/ (Eleventy)").action(runBuildWebsite);

program.command("checksums").description("Write side-by-side .sha256 files for release artifacts").action(runChecksums);

program
  .command("audit-shared")
  .description("Audit shared src/ for node/electron/@tauri leaks (verify gate)")
  .action(runAuditShared);

program
  .command("create-icons")
  .description("Rasterize the icon set from the vector master (or just the Store tiles with --appx)")
  .option("--appx", "only regenerate the Windows Store tiles", false)
  .action((options) => {
    createIcons({ appx: options.appx });
  });

program
  .command("generate-engine-icons")
  .description("Recolor the app-icon template into per-engine SVG/PNG variants (needs Chrome or CDP_URL)")
  .action(runGenerateEngineIcons);

program
  .command("install-self-signed-appx")
  .description("Self-sign the Windows installer/appx")
  .action(installSelfSignedAppx);

program
  .command("uninstall-self-signed-appx")
  .description("Remove any installed ContainerDesktop appx packages")
  .action(uninstallSelfSignedAppx);

if (process.argv.slice(2).length === 0) {
  program.help();
}

program.parseAsync(process.argv).catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
