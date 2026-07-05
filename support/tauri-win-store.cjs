#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const semver = require("semver");
const xml2js = require("xml2js");
const { winArtifactName } = require("./release-artifacts.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const IDENTITY_NAME = "IonutStoica.ContainerDesktop";
const MIN_WINDOWS_VERSION = "10.0.18362.0";
const RUST_TARGETS = {
  x64: "x86_64-pc-windows-msvc",
  arm64: "aarch64-pc-windows-msvc",
};
const STORE_ASSETS = [
  "StoreLogo.png",
  "Square150x150Logo.png",
  "Square44x44Logo.png",
  "Wide310x150Logo.png",
  "SmallTile.png",
  "LargeTile.png",
];

function readPackageJson(projectRoot = PROJECT_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
}

function resolveStorePackageVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}.0`;
}

function resolveStoreIdentity({ pkg, arch = "x64" } = {}) {
  const packageVersion = resolveStorePackageVersion(pkg.version);
  const publisherAuthor = (pkg.author || "").replace(/\s+/g, ".");
  const publisher = process.env.PUBLISHER || `CN=${publisherAuthor}`;
  return {
    identityName: IDENTITY_NAME,
    applicationId: IDENTITY_NAME,
    displayName: pkg.title || pkg.name,
    description: pkg.description || pkg.title || pkg.name,
    publisher,
    publisherDisplayName: process.env.PUBLISHER_DISPLAY_NAME || pkg.author || pkg.title || pkg.name,
    packageVersion,
    arch,
    exeName: `${pkg.desktopName || pkg.name}.exe`,
  };
}

function createStoreManifestObject(identity) {
  return {
    Package: {
      $: {
        xmlns: "http://schemas.microsoft.com/appx/manifest/foundation/windows10",
        "xmlns:uap": "http://schemas.microsoft.com/appx/manifest/uap/windows10",
        "xmlns:desktop": "http://schemas.microsoft.com/appx/manifest/desktop/windows10",
        "xmlns:desktop2": "http://schemas.microsoft.com/appx/manifest/desktop/windows10/2",
        "xmlns:rescap": "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities",
        IgnorableNamespaces: "uap desktop desktop2 rescap",
      },
      Identity: [
        {
          $: {
            Name: identity.identityName,
            Publisher: identity.publisher,
            Version: identity.packageVersion,
            ProcessorArchitecture: identity.arch,
          },
        },
      ],
      Properties: [
        {
          DisplayName: [identity.displayName],
          PublisherDisplayName: [identity.publisherDisplayName],
          Description: [identity.description],
          Logo: ["assets\\StoreLogo.png"],
        },
      ],
      Resources: [
        {
          Resource: [
            {
              $: {
                Language: "en-US",
              },
            },
          ],
        },
      ],
      Dependencies: [
        {
          TargetDeviceFamily: [
            {
              $: {
                Name: "Windows.Desktop",
                MinVersion: MIN_WINDOWS_VERSION,
                MaxVersionTested: MIN_WINDOWS_VERSION,
              },
            },
          ],
        },
      ],
      Capabilities: [
        {
          Capability: [{ $: { Name: "internetClient" } }, { $: { Name: "privateNetworkClientServer" } }],
          "rescap:Capability": [{ $: { Name: "runFullTrust" } }],
        },
      ],
      Applications: [
        {
          Application: [
            {
              $: {
                Id: identity.applicationId,
                Executable: identity.exeName,
                EntryPoint: "Windows.FullTrustApplication",
              },
              "uap:VisualElements": [
                {
                  $: {
                    DisplayName: identity.displayName,
                    Description: identity.description,
                    BackgroundColor: "transparent",
                    Square44x44Logo: "assets\\Square44x44Logo.png",
                    Square150x150Logo: "assets\\Square150x150Logo.png",
                  },
                  "uap:DefaultTile": [
                    {
                      $: {
                        Wide310x150Logo: "assets\\Wide310x150Logo.png",
                        Square71x71Logo: "assets\\SmallTile.png",
                        Square310x310Logo: "assets\\LargeTile.png",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function createStoreManifest(options = {}) {
  const pkg = options.pkg || readPackageJson(options.projectRoot);
  const identity = resolveStoreIdentity({ pkg, arch: options.arch });
  const builder = new xml2js.Builder({
    xmldec: { version: "1.0", encoding: "utf-8" },
    renderOpts: { pretty: true, indent: "  ", newline: "\n" },
  });
  return `${builder.buildObject(createStoreManifestObject(identity))}\n`;
}

function normalizeFormat(format = "appx") {
  const normalized = String(format).toLowerCase();
  if (!["msix", "appx"].includes(normalized)) {
    throw new Error(`Unsupported Tauri Windows Store package format: ${format}`);
  }
  return normalized;
}

function createPackCommand({ stageDir, outputPath }) {
  // makeappx pack builds both .appx and .msix (same OPC package format; the output extension names it).
  // Invoked DIRECTLY rather than through the @microsoft/winappcli `winapp` wrapper, which swallowed
  // makeappx's error output and failed on CI runners even though makeappx itself packs the manifest fine.
  // `command: "makeappx"` is a logical name; runPackCommand resolves the real makeappx.exe at pack time.
  return {
    command: "makeappx",
    args: ["pack", "/d", stageDir, "/p", outputPath, "/o"],
  };
}

function compareWindowsKitVersions(a, b) {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const delta = (pa[index] || 0) - (pb[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

// Locate makeappx.exe from the Windows 10/11 SDK (highest version, host tools), falling back to PATH.
// Resolved lazily (only at pack time) so this module still imports on non-Windows for the unit tests.
function findMakeAppx() {
  if (process.env.MAKEAPPX_PATH && fs.existsSync(process.env.MAKEAPPX_PATH)) {
    return process.env.MAKEAPPX_PATH;
  }
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const kitsBin = path.join(programFilesX86, "Windows Kits", "10", "bin");
  if (fs.existsSync(kitsBin)) {
    const versions = fs
      .readdirSync(kitsBin)
      .filter((name) => /^10\.\d/.test(name))
      .sort((a, b) => compareWindowsKitVersions(b, a));
    for (const version of versions) {
      for (const hostArch of ["x64", "x86"]) {
        const candidate = path.join(kitsBin, version, hostArch, "makeappx.exe");
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return "makeappx.exe";
}

function createStorePackagePlan(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const releaseDir = options.releaseDir || path.join(projectRoot, "release");
  const pkg = options.pkg || readPackageJson(projectRoot);
  const arch = options.arch || "x64";
  const format = normalizeFormat(options.format);
  const target = options.target || RUST_TARGETS[arch];
  if (!target) {
    throw new Error(`No Rust target configured for Windows Store arch: ${arch}`);
  }

  const identity = resolveStoreIdentity({ pkg, arch });
  const stageDir = path.join(releaseDir, "tauri-win-store", arch);
  const assetsDir = path.join(stageDir, "assets");
  // makeappx pack always reads the manifest named AppxManifest.xml from the content dir, for .appx and .msix alike.
  const manifestPath = path.join(stageDir, "AppxManifest.xml");
  const outputPath = path.join(releaseDir, winArtifactName(arch, pkg.version, format));
  const targetReleaseDir = path.join(projectRoot, "src-tauri", "target", target, "release");
  const files = [
    {
      source: path.join(targetReleaseDir, identity.exeName),
      destination: path.join(stageDir, identity.exeName),
    },
    ...STORE_ASSETS.map((name) => ({
      source: path.join(projectRoot, "src", "resources", "appx", name),
      destination: path.join(assetsDir, name),
    })),
  ];
  const manifest = createStoreManifest({ pkg, arch });

  return {
    ...identity,
    projectRoot,
    releaseDir,
    target,
    format,
    stageDir,
    assetsDir,
    manifestPath,
    outputPath,
    files,
    manifest,
    packCommand: createPackCommand({ stageDir, outputPath }),
  };
}

function stageStorePackage(plan) {
  fs.rmSync(plan.stageDir, { recursive: true, force: true });
  fs.mkdirSync(plan.assetsDir, { recursive: true });
  fs.writeFileSync(plan.manifestPath, plan.manifest, "utf8");
  for (const file of plan.files) {
    if (!fs.existsSync(file.source)) {
      throw new Error(`Missing Tauri Windows Store input: ${file.source}`);
    }
    fs.mkdirSync(path.dirname(file.destination), { recursive: true });
    fs.copyFileSync(file.source, file.destination);
  }
}

function runPackCommand(plan) {
  const executable = plan.packCommand.command === "makeappx" ? findMakeAppx() : plan.packCommand.command;
  const { args } = plan.packCommand;
  console.log(`> ${executable} ${args.join(" ")}`);
  // stdio inherit so makeappx's own diagnostics reach the log (the winappcli wrapper used to swallow them).
  const result = childProcess.spawnSync(executable, args, {
    cwd: plan.projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Failed to launch makeappx (${executable}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `makeappx pack failed (exit ${result.status}${result.signal ? `, signal ${result.signal}` : ""}): ${executable} ${args.join(" ")}`,
    );
  }
}

function parseArgs(argv) {
  const args = { command: argv[2] || "pack", arch: "x64", format: "appx", dryRun: false };
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--arch" || arg === "--target" || arg === "--format" || arg === "--release-dir") {
      args[arg.slice(2).replace("-", "_")] = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const plan = createStorePackagePlan({
    arch: args.arch,
    target: args.target,
    format: args.format,
    releaseDir: args.release_dir ? path.resolve(args.release_dir) : undefined,
  });

  if (args.command === "manifest") {
    process.stdout.write(plan.manifest);
    return;
  }
  if (!["stage", "pack"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}`);
  }

  if (!args.dryRun) {
    stageStorePackage(plan);
  }
  if (args.command === "pack") {
    if (args.dryRun) {
      console.log(`${plan.packCommand.command} ${plan.packCommand.args.map((part) => JSON.stringify(part)).join(" ")}`);
    } else {
      runPackCommand(plan);
    }
  }
  console.log(`Tauri Windows Store ${plan.format.toUpperCase()}: ${plan.outputPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  createPackCommand,
  createStoreManifest,
  createStorePackagePlan,
  normalizeFormat,
  resolveStoreIdentity,
};
