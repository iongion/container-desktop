import base64
import fnmatch
import glob
import hashlib
import json
import os
import platform
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from dotenv import dotenv_values
from invoke import Collection, Exit, task

from support.ci_artifacts import (
    parse_windows_store_package_version,
    select_windows_artifact,
    windows_artifact_name,
)
from support.versioning import (
    bump_version,
    extract_changelog_section,
    promote_changelog,
    render_homebrew_rb,
    set_manifest_version,
    set_package_json_version,
    set_plain_version,
)


PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "container-desktop"
PROJECT_VERSION = Path(os.path.join(PROJECT_HOME, "VERSION")).read_text(encoding="utf-8").strip()
NODE_ENV = os.environ.get("NODE_ENV", "development")
ENVIRONMENT = os.environ.get("ENVIRONMENT", NODE_ENV)
APP_PROJECT_VERSION = PROJECT_VERSION
TARGET = os.environ.get("TARGET", "linux")
PORT = int(os.environ.get("PORT", str(3000)))
PTY = os.name != "nt"
LOCAL_BUILD_BOX_KEYS = {
    "win": "BUILD_WIN_BOX",
    "mac": "BUILD_MAC_BOX",
    "linux": "BUILD_LIN_BOX",
}
LOCAL_BUILD_BOX_PATH_KEYS = {
    "win": "BUILD_WIN_BOX_PATH",
    "mac": "BUILD_MAC_BOX_PATH",
    "linux": "BUILD_LIN_BOX_PATH",
}
REMOTE_BUILD_ROOT = "container-desktop-remote-build/container-desktop"
REMOTE_SOURCE_ARCHIVE = "source.tar.gz"
REMOTE_ARTIFACT_ARCHIVE = "artifacts.tar.gz"
REMOTE_EXCLUDED_DIRS = {
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".turbo",
    ".venv",
    ".vscode",
    "build",
    "dist",
    "node_modules",
    "release",
    "temp",
    "website",
}
REMOTE_EXCLUDED_FILES = {
    ".env.local",
    ".env.development.local",
    ".env.test.local",
    ".env.production.local",
}
REMOTE_EXCLUDED_PATTERNS = (
    "*.log",
    "*.pyc",
    ".DS_Store",
)


def _is_arm_machine(machine):
    return machine.lower() in {"aarch64", "arm64", "arm"}


def bundle_script_for_target(target=None, system=None, machine=None):
    target = target or os.environ.get("TARGET", TARGET)
    if target == "linux-x64":
        return "package:tauri:linux_x86"
    if target == "linux-arm64":
        return "package:tauri:linux_arm"
    if target == "macos-arm64":
        return "package:tauri:mac_arm"
    if target == "windows-x64":
        return "package:tauri:win_x64"
    if target == "windows-arm":
        return "package:tauri:win_arm"

    resolved_system = system or platform.system()
    resolved_machine = machine or platform.machine()
    if target == "linux":
        return "package:tauri:linux_arm" if _is_arm_machine(resolved_machine) else "package:tauri:linux_x86"
    if target == "macos" or resolved_system == "Darwin":
        return "package:tauri:mac_arm"
    if target == "windows" or resolved_system == "Windows":
        return "package:tauri:win_arm" if _is_arm_machine(resolved_machine) else "package:tauri:win_x64"
    raise Exit(f"Unsupported bundle target: {target}")


def env_source_files(environment=ENVIRONMENT):
    return (
        (".env", False),
        (".env.local", True),
        (f".env.{environment}", True),
        (f".env.{environment}.local", True),
    )


def source_env_values(project_root=PROJECT_HOME, environment=ENVIRONMENT, environ=None):
    root = Path(project_root)
    values = dict(os.environ if environ is None else environ)
    for filename, override in env_source_files(environment):
        path = root / filename
        if not path.exists():
            continue
        for key, value in dotenv_values(path).items():
            if value is None:
                continue
            if override or key not in values:
                values[key] = value
    return values


def load_local_build_boxes(project_root=PROJECT_HOME, environ=None, environment=ENVIRONMENT):
    values = source_env_values(project_root, environment, environ)
    return {
        platform_key: str(values.get(env_key, "")).strip() for platform_key, env_key in LOCAL_BUILD_BOX_KEYS.items()
    }


def load_local_build_box_paths(project_root=PROJECT_HOME, environ=None, environment=ENVIRONMENT):
    values = source_env_values(project_root, environment, environ)
    return {
        platform_key: str(values.get(env_key, "")).strip()
        for platform_key, env_key in LOCAL_BUILD_BOX_PATH_KEYS.items()
    }


def package_platform_for_script(script):
    script = str(script or "")
    if ":win" in script or "windows" in script:
        return "win"
    if ":mac" in script or "macos" in script or "darwin" in script:
        return "mac"
    if ":linux" in script or "linux" in script:
        return "linux"
    return None


def local_platform_key(system=None):
    resolved = (system or platform.system()).lower()
    if resolved.startswith("win"):
        return "win"
    if resolved == "darwin":
        return "mac"
    if resolved == "linux":
        return "linux"
    return None


def _truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _env_value(env, key):
    if env is not None and key in env:
        return env[key]
    return os.environ.get(key)


def _is_ci(env=None):
    return _truthy(_env_value(env, "CI")) or _truthy(_env_value(env, "GITHUB_ACTIONS"))


def resolve_remote_bundle(script, env=None, system=None, project_root=PROJECT_HOME, environment=None):
    if _is_ci(env):
        return None

    target_platform = package_platform_for_script(script)
    host_platform = local_platform_key(system)
    if target_platform is None or target_platform == host_platform:
        return None

    resolved_environment = environment or _env_value(env, "ENVIRONMENT") or ENVIRONMENT
    boxes = load_local_build_boxes(project_root, environment=resolved_environment)
    paths = load_local_build_box_paths(project_root, environment=resolved_environment)
    for platform_key, env_key in LOCAL_BUILD_BOX_KEYS.items():
        if env is not None and env_key in env:
            boxes[platform_key] = str(env[env_key]).strip()
    for platform_key, env_key in LOCAL_BUILD_BOX_PATH_KEYS.items():
        if env is not None and env_key in env:
            paths[platform_key] = str(env[env_key]).strip()
    box = boxes.get(target_platform, "")
    if not box:
        return None

    return {
        "platform": target_platform,
        "box": box,
        "script": script,
        "root": paths.get(target_platform) or REMOTE_BUILD_ROOT,
    }


def _remote_path(remote_root, filename):
    return f"{remote_root.rstrip('/')}/{filename}"


def _run_process(args, cwd=None):
    print("+ " + " ".join(shlex.quote(str(arg)) for arg in args))
    subprocess.run(args, cwd=cwd, check=True)  # noqa: S603 - argv comes from local build configuration.


def _powershell_command(script):
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    return f"powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {encoded}"


def _posix_command(script):
    return f"bash -lc {shlex.quote(script)}"


def _remote_command(platform_key, script):
    if platform_key == "win":
        return _powershell_command(script)
    return _posix_command(script)


def _ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def _windows_prepare_script(remote_root=REMOTE_BUILD_ROOT):
    root = _ps_quote(remote_root)
    return "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            "$ProgressPreference = 'SilentlyContinue'",
            f"$root = {root}",
            "New-Item -ItemType Directory -Force -Path $root | Out-Null",
            "Remove-Item -Force -ErrorAction SilentlyContinue -Path (Join-Path $root 'source.tar.gz')",
            "Remove-Item -Force -ErrorAction SilentlyContinue -Path (Join-Path $root 'artifacts.tar.gz')",
            "exit 0",
        ]
    )


def _windows_build_script(script, remote_root=REMOTE_BUILD_ROOT):
    root = _ps_quote(remote_root)
    package_script = _ps_quote(script)
    return "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            "$ProgressPreference = 'SilentlyContinue'",
            "function Invoke-Yarn {",
            "  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)",
            "  if (Get-Command yarn -ErrorAction SilentlyContinue) { & yarn @Arguments; return }",
            "  if (Get-Command corepack -ErrorAction SilentlyContinue) { & corepack yarn @Arguments; return }",
            "  throw 'Remote build requires yarn or corepack on PATH'",
            "}",
            f"$root = {root}",
            "$source = Join-Path $root 'source'",
            "$sourceArchive = Join-Path $root 'source.tar.gz'",
            "$artifactsArchive = Join-Path $root 'artifacts.tar.gz'",
            "if (Test-Path $source) { Remove-Item -Recurse -Force $source }",
            "New-Item -ItemType Directory -Force -Path $source | Out-Null",
            "tar -xzf $sourceArchive -C $source",
            "Set-Location $source",
            "Invoke-Yarn install --frozen-lockfile --production=false",
            f"Invoke-Yarn {package_script}",
            "if (-not (Test-Path 'release')) { throw 'Remote build did not create release directory' }",
            "tar -czf $artifactsArchive -C release .",
        ]
    )


def _posix_prepare_script(remote_root=REMOTE_BUILD_ROOT):
    root = shlex.quote(remote_root)
    return "\n".join(
        [
            "set -euo pipefail",
            f"root={root}",
            'mkdir -p "$root"',
            'rm -f "$root/source.tar.gz" "$root/artifacts.tar.gz"',
        ]
    )


def _posix_build_script(script, remote_root=REMOTE_BUILD_ROOT):
    root = shlex.quote(remote_root)
    package_script = shlex.quote(script)
    return "\n".join(
        [
            "set -euo pipefail",
            f"root={root}",
            "remote_yarn() {",
            '  if command -v yarn >/dev/null 2>&1; then yarn "$@"; return; fi',
            '  if command -v corepack >/dev/null 2>&1; then corepack yarn "$@"; return; fi',
            "  echo 'Remote build requires yarn or corepack on PATH' >&2",
            "  exit 127",
            "}",
            'source_dir="$root/source"',
            'rm -rf "$source_dir"',
            'mkdir -p "$source_dir"',
            'tar -xzf "$root/source.tar.gz" -C "$source_dir"',
            'cd "$source_dir"',
            "remote_yarn install --frozen-lockfile --production=false",
            f"remote_yarn {package_script}",
            "test -d release",
            'tar -czf "$root/artifacts.tar.gz" -C release .',
        ]
    )


def _prepare_script(platform_key, remote_root=REMOTE_BUILD_ROOT):
    if platform_key == "win":
        return _windows_prepare_script(remote_root)
    return _posix_prepare_script(remote_root)


def _build_script(platform_key, script, remote_root=REMOTE_BUILD_ROOT):
    if platform_key == "win":
        return _windows_build_script(script, remote_root)
    return _posix_build_script(script, remote_root)


def _is_remote_excluded(rel_path):
    rel = rel_path.as_posix()
    name = rel_path.name
    parts = set(rel_path.parts)
    if parts.intersection(REMOTE_EXCLUDED_DIRS):
        return True
    if rel.startswith("src-tauri/target/"):
        return True
    if name in REMOTE_EXCLUDED_FILES:
        return True
    return any(fnmatch.fnmatch(name, pattern) for pattern in REMOTE_EXCLUDED_PATTERNS)


def _create_remote_source_archive(project_root, archive_path):
    root = Path(project_root)
    with tarfile.open(archive_path, "w:gz") as archive:
        for current_root, dirnames, filenames in os.walk(root):
            current = Path(current_root)
            relative_dir = current.relative_to(root)
            dirnames[:] = [dirname for dirname in dirnames if not _is_remote_excluded(relative_dir / dirname)]
            for filename in filenames:
                rel_path = relative_dir / filename
                if _is_remote_excluded(rel_path):
                    continue
                archive.add(current / filename, arcname=rel_path.as_posix(), recursive=False)


def _extract_remote_artifacts(archive_path, release_dir):
    release_dir = Path(release_dir)
    release_dir.mkdir(exist_ok=True)
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            filename = Path(member.name).name
            if not filename.startswith(f"{PROJECT_CODE}-"):
                continue
            source = archive.extractfile(member)
            if source is None:
                continue
            destination = release_dir / filename
            with source, open(destination, "wb") as output:
                shutil.copyfileobj(source, output)


def run_remote_bundle(ctx, remote_plan, env=None):
    del ctx, env
    box = remote_plan["box"]
    platform_key = remote_plan["platform"]
    script = remote_plan["script"]
    remote_root = remote_plan.get("root") or REMOTE_BUILD_ROOT
    if shutil.which("ssh") is None or shutil.which("scp") is None:
        raise Exit("Remote bundle builds require both `ssh` and `scp` on PATH.")

    print(f"Building {script} on {box} via {LOCAL_BUILD_BOX_KEYS[platform_key]}")
    with tempfile.TemporaryDirectory(prefix="container-desktop-remote-build-") as temp_dir:
        temp = Path(temp_dir)
        source_archive = temp / REMOTE_SOURCE_ARCHIVE
        artifacts_archive = temp / REMOTE_ARTIFACT_ARCHIVE
        _create_remote_source_archive(PROJECT_HOME, source_archive)
        _run_process(["ssh", box, _remote_command(platform_key, _prepare_script(platform_key, remote_root))])
        _run_process(["scp", str(source_archive), f"{box}:{_remote_path(remote_root, REMOTE_SOURCE_ARCHIVE)}"])
        _run_process(["ssh", box, _remote_command(platform_key, _build_script(platform_key, script, remote_root))])
        _run_process(["scp", f"{box}:{_remote_path(remote_root, REMOTE_ARTIFACT_ARCHIVE)}", str(artifacts_archive)])
        _extract_remote_artifacts(artifacts_archive, Path(PROJECT_HOME, "release"))


def _urlopen(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")
    return urllib.request.urlopen(url)  # noqa: S310 - scheme is validated above.


def url_download(url, path):
    with _urlopen(url) as response, open(path, "wb") as out_file:
        shutil.copyfileobj(response, out_file)


def get_env():
    return {
        "BROWSER": "none",
        "PORT": str(PORT),
        "PROJECT_HOME": PROJECT_HOME,
        "PROJECT_CODE": PROJECT_CODE,
        "PROJECT_VERSION": PROJECT_VERSION,
        "NODE_ENV": NODE_ENV,
        "TARGET": TARGET,
        "PUBLIC_URL": ".",
        # Global
        "ENVIRONMENT": ENVIRONMENT,
        "APP_PROJECT_VERSION": APP_PROJECT_VERSION,
    }


def run_env(ctx, cmd, env=None):
    cmd_env = {**get_env(), **({} if env is None else env)}
    nvm_dir = os.getenv("NVM_DIR", str(Path.home().joinpath(".nvm")))
    nvm_sh = os.path.join(nvm_dir, "nvm.sh")
    if os.environ.get("CI") != "true" and os.path.exists(nvm_sh):
        with ctx.prefix(f'source "{nvm_dir}/nvm.sh"'):
            nvm_rc = os.path.join(ctx.cwd, ".nvmrc")
            if os.path.exists(nvm_rc):
                with ctx.prefix("nvm use"):
                    ctx.run(cmd, env=cmd_env, pty=PTY)
            else:
                ctx.run(cmd, env=cmd_env, pty=PTY)
    else:
        ctx.run(cmd, env=cmd_env, pty=PTY)


@task
def uninstall_self_signed_appx(ctx):
    appx_list_process = ctx.run(
        'powershell.exe -Command "(Get-AppxPackage | Select Name, PackageFullName | ConvertTo-Json)"',
        warn=False,
        echo=False,
    )
    try:
        appx_list = json.loads(appx_list_process.stdout or "[]")
        for app in appx_list:
            if "ContainerDesktop" in app["Name"]:
                print(f"Appx already installed: {app['Name']} - removing {app['PackageFullName']}")
                ctx.run(f'powershell.exe -Command "Remove-AppxPackage -Package \\"{app["PackageFullName"]}\\""')
    except:
        print("Unable to parse appx list")


@task
def install_self_signed_appx(ctx):
    # Find if appx is already installed
    uninstall_self_signed_appx(ctx)
    # Generate and import certificate if not found
    path = Path(PROJECT_HOME)
    pfx_path = os.path.join(path, "temp/self-signed.pfx")
    if not os.path.exists(pfx_path):
        print("Certificate not found - generating")
        cert_config_path = os.path.join(path, "support/openssl.conf")
        private_key_path = os.path.join(path, "temp/self-signed-private.key")
        if not os.path.exists(private_key_path):
            print(f"Private key not found at {private_key_path} - generating")
            ctx.run(f"openssl genrsa -out {private_key_path} 2048")
        # Generate CSR
        os.makedirs(os.path.join(path, "temp"), exist_ok=True)
        csr_path = os.path.join(path, "temp/self-signed.csr")
        if not os.path.exists(csr_path):
            print(f"CSR not found at {csr_path} - generating")
            ctx.run(f"openssl req -new -key {private_key_path} -out {csr_path} -config {cert_config_path}")
        # Self sign
        cert_path = os.path.join(path, "temp/self-signed.crt")
        if not os.path.exists(cert_path):
            print(f"Certificate not found at {cert_path} - generating")
            ctx.run(
                f"openssl x509 -req -in {csr_path} -signkey {private_key_path} -out {cert_path} -days 365 -extensions v3_req -extfile {cert_config_path}"
            )
        # Create pfx
        if not os.path.exists(pfx_path):
            print(f"PFX not found at {pfx_path} - generating")
            ctx.run(
                f'openssl pkcs12 -export -out {pfx_path} -inkey {private_key_path} -in {cert_path} -name "Container Desktop" -passout pass:123456'
            )
    # Signing the bundles
    jar_path = os.path.join(path, "temp/jsign-6.0.jar")
    ts_url = ",".join(
        [
            # Add more if needed
            "http://timestamp.sectigo.com/rfc3161",
            "http://timestamp.globalsign.com/scripts/timstamp.dll",
            "http://timestamp.comodoca.com/authenticode",
            "http://sha256timestamp.ws.symantec.com/sha256/timestamp",
        ]
    )
    exe_path = os.path.join(path, "release", f"container-desktop-x64-{PROJECT_VERSION}.exe")
    appx_path = os.path.join(path, "release", f"container-desktop-x64-{PROJECT_VERSION}.appx")
    with ctx.cd(path):
        if os.path.exists(exe_path):
            print(f"Signing {exe_path}")
            shutil.copy(exe_path, f"{exe_path}.unsigned")
            run_env(
                ctx,
                f'java -jar "{jar_path}" --keystore {pfx_path} --storetype PKCS12 --storepass 123456"" --tsaurl "{ts_url}" "{exe_path}"',
            )
        if os.path.exists(appx_path):
            print(f"Signing {appx_path}")
            shutil.copy(appx_path, f"{appx_path}.unsigned")
            run_env(
                ctx,
                f'java -jar "{jar_path}" --keystore {pfx_path} --storetype PKCS12 --storepass 123456"" --tsaurl "{ts_url}" "{appx_path}"',
            )


@task
def build(ctx, env=None):
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        shutil.rmtree("build", ignore_errors=True)
        run_env(ctx, "yarn build", env)
        # Icons are loaded from __dirname at runtime, so co-locate them with the
        # versioned build output (build/<version>/) next to main.cjs.
        build_dir = os.path.join("build", PROJECT_VERSION)
        for file in glob.glob("./src/resources/icons/appIcon*"):
            shutil.copy(file, build_dir)
        for file in glob.glob("./src/resources/icons/trayIcon*"):
            shutil.copy(file, build_dir)


@task
def bundle(ctx, env=None):
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        env = {} if env is None else env
        script = (
            env.get("PACKAGE_SCRIPT") or os.environ.get("PACKAGE_SCRIPT") or bundle_script_for_target(env.get("TARGET"))
        )
        remote_plan = resolve_remote_bundle(script, env)
        if remote_plan is None:
            run_env(ctx, f"yarn {script}", env)
        else:
            run_remote_bundle(ctx, remote_plan, env)


@task(name="tauri-win-store")
def tauri_win_store(ctx, package_format="appx", env=None):
    """Build the Tauri Windows Store package through Microsoft winapp tooling.

    Default is AppX for Electron artifact parity. Pass ``--package-format msix``
    only when following Microsoft's current WinApp CLI MSIX flow explicitly.
    """
    if package_format not in {"msix", "appx"}:
        raise Exit("--package-format must be either 'msix' or 'appx'")
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, f"yarn package:tauri:win_store:{package_format}", env)


@task
def checksums(ctx, env=None):
    items = glob.glob(os.path.join(PROJECT_HOME, "release", "container-desktop-*"))
    for installer_path in items:
        if installer_path.endswith(".sha256"):
            continue
        checksum_path = f"{installer_path}.sha256"
        print(f"Creating checksum for {installer_path}")
        with open(installer_path, "rb") as fp:
            checksum = hashlib.sha256(fp.read()).hexdigest()
        with open(checksum_path, "w", encoding="utf-8") as fp:
            fp.write(checksum)


@task(default=True)
def show_help(ctx):
    ctx.run("invoke --list")


@task
def prepare(ctx, docs=False):
    # Install infrastructure dependencies
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, "yarn install --frozen-lockfile --production=false")


@task
def release(ctx, docs=False):
    env = {
        "NODE_ENV": "production",
        "ENVIRONMENT": "production",
    }
    bundle(ctx, env)
    checksums(ctx, env)


@task
def clean(c, docs=False):
    path = Path(PROJECT_HOME)
    with c.cd(os.path.dirname(path)):
        shutil.rmtree("node_modules", ignore_errors=True)
        shutil.rmtree("bin", ignore_errors=True)
        shutil.rmtree("build", ignore_errors=True)
        shutil.rmtree("release", ignore_errors=True)


@task
def start(ctx, docs=False):
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        run_env(ctx, "yarn dev")


@task(name="build-website")
def build_website(ctx):
    """Compile website-src/ into website/ (Eleventy static site generator).

    website/ is fully generated output: it is cleaned, then rebuilt. The version
    and per-release download URLs are baked in from package.json at build time,
    so no string-replacement step is needed.
    """
    shutil.rmtree(os.path.join(PROJECT_HOME, "website"), ignore_errors=True)
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, "yarn build:website")


@task(name="update-screenshots")
def update_screenshots(ctx):
    """Regenerate deterministic website screenshots from the mock backend."""
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, "yarn screenshots")


@task(name="update-demo-replay")
def update_demo_replay(ctx):
    """Regenerate the website rrweb demo replay from the mock backend."""
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, "yarn demo:record")


# versioning & release metadata
#
# package.json `version` is the single source of truth. `version-sync` and
# `bump` derive the other "synced" files (VERSION, public/manifest.json) from
# it. Files coupled to published release artifacts -- the docs download page and
# the homebrew cask -- are rendered separately by `publish-meta`, because they
# need real per-asset sha256 hashes that a bare version string cannot produce.

REPO_SLUG = "iongion/container-desktop"


def _read_text(rel):
    return Path(os.path.join(PROJECT_HOME, rel)).read_text(encoding="utf-8")


def _write_text(rel, content):
    Path(os.path.join(PROJECT_HOME, rel)).write_text(content, encoding="utf-8")


def read_source_version():
    """The single source of truth: package.json `version`."""
    return json.loads(_read_text("package.json"))["version"]


def _apply(targets, perform):
    changed = 0
    for rel, new_content in targets:
        if _read_text(rel) == new_content:
            print(f"  = {rel}")
            continue
        changed += 1
        print(f"  {'updated' if perform else 'would update'}: {rel}")
        if perform:
            _write_text(rel, new_content)
    print(f"{changed} file(s) {'updated' if perform else 'pending'}")


def _synced_targets(version):
    return [
        ("package.json", set_package_json_version(_read_text("package.json"), version)),
        ("VERSION", set_plain_version(_read_text("VERSION"), version)),
        ("public/manifest.json", set_manifest_version(_read_text("public/manifest.json"), version)),
    ]


@task(name="version-sync")
def version_sync(ctx, version=None, perform=False):
    """Write the source version into all synced files (drift repair, no bump).

    Uses package.json by default; pass --version X.Y.Z to force one. Prints the
    plan unless --perform is given.
    """
    version = version or read_source_version()
    print(f"Sync synced files to {version}" + ("" if perform else "  (dry-run; pass --perform)"))
    _apply(_synced_targets(version), perform)


def _commit_release(ctx, version):
    """Stage every working-tree change, commit, tag and push.

    A release commit captures the whole regenerated state -- bumped version files,
    the rebuilt website/, captured screenshots/replays and any regenerated support
    assets (icons, appx tiles) -- so nothing is missed by an out-of-date path list.
    `temp/` and other build scratch are gitignored; run from an otherwise-clean tree
    so only release content is swept in.
    """
    with ctx.cd(PROJECT_HOME):
        ctx.run("git add -A")
        ctx.run(f'git commit -m "Release {version}"')
        ctx.run(f'git tag -a "{version}" -m "{version}"')
        ctx.run("git push")
        ctx.run("git push --tags")


@task
def bump(ctx, part="patch", perform=False, commit=True):
    """Bump the version everywhere and (with --perform) commit, tag and push.

    Increments package.json by --part (patch|minor|major), updates VERSION and
    the web manifest, and promotes the CHANGELOG [Unreleased] section.

    Refuses to run when [Unreleased] is empty -- a release must document
    something. Pass --no-commit to write the bumped files but skip git: `make
    release` uses that to bump first, then regenerate the screenshots, demo
    replay and website/, and finally commit them together with the version via
    `commit-release` -- so the tag ships the site, media and version in sync.
    """
    # Refuse to release an empty changelog (extract_changelog_section raises on
    # an empty section body); the same heading regex matches "[Unreleased]".
    try:
        extract_changelog_section(_read_text("CHANGELOG.md"), "Unreleased")
    except ValueError as exc:
        raise Exit(f"Refusing to bump: {exc} -- add entries to the [Unreleased] section first.") from exc
    current = read_source_version()
    version = bump_version(current, part)
    print(f"Bump {current} -> {version} ({part})" + ("" if perform else "  (dry-run; pass --perform)"))
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    targets = _synced_targets(version)
    targets.append(("CHANGELOG.md", promote_changelog(_read_text("CHANGELOG.md"), version, today)))
    _apply(targets, perform)
    if not perform:
        print("Re-run with --perform to write files" + ("" if commit else " (--no-commit writes files only)") + ".")
        return
    if not commit:
        print(f"Wrote bumped files for {version}; skipping git (--no-commit) -- finish with `invoke commit-release`.")
        return
    _commit_release(ctx, version)


@task(name="commit-release")
def commit_release(ctx):
    """Commit an already-bumped release -- every working-tree change (version files,
    the regenerated website/, screenshots, demo replay and any support assets) --
    then tag and push, WITHOUT re-bumping.

    This is the git tail of `bump --perform`, but staging the generated content too.
    `make release` calls it after bumping (--no-commit) and regenerating the
    screenshots, demo replay and website/, so docs, site, media and version all
    land in one release commit that CDPipeline then simply deploys.
    """
    version = read_source_version()
    print(f"Commit release {version} (all working-tree changes: version files + website/ + assets)")
    _commit_release(ctx, version)


def _latest_release_version(ctx):
    result = ctx.run(
        f"gh release view --repo {REPO_SLUG} --json tagName --jq .tagName",
        hide=True,
        warn=True,
    )
    tag = (result.stdout or "").strip()
    if not tag:
        raise Exception("unable to resolve latest published release; pass --version")
    return tag.lstrip("v")


def _artifact_sha256(version):
    # macOS ships arm64 only.
    name = f"container-desktop-mac-arm64-{version}.dmg.sha256"
    local = os.path.join(PROJECT_HOME, "release", name)
    if os.path.exists(local):
        return Path(local).read_text(encoding="utf-8").strip().split()[0]
    url = f"https://github.com/{REPO_SLUG}/releases/download/{version}/{name}"
    with _urlopen(url) as response:
        return response.read().decode("utf-8").strip().split()[0]


def _quote(value):
    return shlex.quote(str(value))


def _release_dir():
    path = Path(PROJECT_HOME, "release")
    path.mkdir(exist_ok=True)
    return path


def _release_run_ids(run_id):
    if not run_id:
        return []
    return [item for item in str(run_id).replace(",", " ").split() if item]


def _download_workflow_artifacts(ctx, run_id, release_dir):
    download_dir = release_dir / f"_workflow-{run_id}"
    shutil.rmtree(download_dir, ignore_errors=True)
    ctx.run(f"gh run download {_quote(run_id)} --repo {_quote(REPO_SLUG)} --dir {_quote(download_dir)}")
    for src in sorted(download_dir.rglob(f"{PROJECT_CODE}*")):
        if src.is_file():
            shutil.copy2(src, release_dir / src.name)
    shutil.rmtree(download_dir, ignore_errors=True)


def _asset_belongs_to_release(name, version):
    if name in {f"{PROJECT_CODE}-installer.exe", f"{PROJECT_CODE}-installer.exe.sha256"}:
        return True
    unchecksummed = name.removesuffix(".sha256")
    return f"-{version}." in unchecksummed or f"-{version}-" in unchecksummed


def _write_release_checksums(release_dir, version):
    for asset in sorted(release_dir.glob(f"{PROJECT_CODE}*")):
        if not asset.is_file() or asset.name.endswith(".sha256") or not _asset_belongs_to_release(asset.name, version):
            continue
        checksum = hashlib.sha256(asset.read_bytes()).hexdigest()
        asset.with_name(f"{asset.name}.sha256").write_text(checksum, encoding="utf-8")


def _public_release_assets(release_dir, version):
    unsigned_windows = {
        f"{PROJECT_CODE}-{arch}-{version}.{ext}"
        for arch in ("x64", "arm64")
        for ext in ("exe", "exe.sha256", "appx", "appx.sha256", "msix", "msix.sha256")
    }
    return sorted(
        asset
        for asset in release_dir.glob(f"{PROJECT_CODE}*")
        if asset.is_file() and _asset_belongs_to_release(asset.name, version) and asset.name not in unsigned_windows
    )


def _write_release_notes(version, release_dir):
    body = "# Changelog\n\n" + extract_changelog_section(_read_text("CHANGELOG.md"), version)
    notes = release_dir / f"release-notes-{version}.md"
    notes.write_text(body, encoding="utf-8")
    return notes


def _release_exists(ctx, version):
    result = ctx.run(f"gh release view {_quote(version)} --repo {_quote(REPO_SLUG)}", hide=True, warn=True)
    return result.ok


@task(name="publish-release")
def publish_release(ctx, version=None, run_id=None, title=None, perform=False, clobber=False, replace=False):
    """Local-only GitHub release publisher wrapper.

    The implementation lives in ``support/release-artifacts.cjs`` so artifact
    names, website download links and release publishing share one source of
    truth. Dry-run by default; pass ``--perform`` after copying the Microsoft
    Store wrapper to ``release/container-desktop-installer.exe``.
    """
    command = ["node", "support/release-artifacts.cjs", "publish"]
    if version:
        command.extend(["--version", version])
    if run_id:
        command.extend(["--run-id", run_id])
    if title:
        command.extend(["--title", title])
    if perform:
        command.append("--perform")
    if clobber:
        command.append("--clobber")
    if replace:
        command.append("--replace")
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, " ".join(_quote(part) for part in command))


@task(name="publish-meta")
def publish_meta(ctx, version=None, perform=False):
    """Render website + homebrew cask for a PUBLISHED release (defaults to latest).

    Points the website download page and homebrew cask at a real, downloadable
    release. Homebrew sha256 values come from release/ if present, else from the
    published GitHub release. Prints the plan unless --perform is given.
    """
    version = version or _latest_release_version(ctx)
    print(f"Render published metadata for {version}" + ("" if perform else "  (dry-run; pass --perform)"))
    rb = "support/homebrew-cask/container-desktop.rb"
    if perform:
        build_website(ctx)  # version + download URLs baked in from package.json
        print("  rebuilt: website/ (generated from website-src/)")
        sha_arm = _artifact_sha256(version)
        _write_text(rb, render_homebrew_rb(_read_text(rb), version, sha_arm))
        print(f"  updated: {rb}")
    else:
        print("  would rebuild: website/ (from website-src/) via build-website")
        print(f"  would update: {rb} (fetch dmg sha256 for arm64)")


def _repo_artifacts(ctx):
    """The newest ~100 GitHub Actions upload artifacts for the repo (parsed JSON)."""
    result = ctx.run(
        f"gh api {_quote(f'repos/{REPO_SLUG}/actions/artifacts?per_page=100')}",
        hide=True,
        warn=True,
    )
    if not result.ok:
        raise Exit("Could not list GitHub artifacts -- is `gh` installed and authenticated? Try `gh auth login`.")
    return json.loads(result.stdout or "{}").get("artifacts", [])


@task(name="fetch-appx")
def fetch_appx(ctx, run_id=None, version=None, arch="x64", keep=False):
    """Download the Microsoft Store package from a CDPipeline run (no local build).

    The Windows CD job builds a Store-ready AppX/MSIX but keeps it OFF the public
    GitHub release (there it is superseded by the signed installer + portable
    zip), so it only lives inside that run's per-arch Windows upload artifact.
    This fetches that artifact with `gh`, extracts just the package
    (+ .sha256), verifies the checksum and drops it in release/ -- ready to
    upload to Partner Center. Runs on macOS/Linux: no Windows or build toolchain
    needed, only an authenticated `gh` CLI.

    Defaults to the newest non-expired Windows x64 artifact. Pass --arch arm64
    for the Windows ARM package, --run-id to target a specific run (`gh run list
    --workflow CDPipeline.yml`), or --version to assert the fetched build matches
    (errors on mismatch instead of silently guessing). Pass --keep to leave the
    raw download dir in place for inspection.
    """
    release_dir = _release_dir()
    artifact_name = windows_artifact_name(arch)
    if run_id is None:
        artifact = select_windows_artifact(_repo_artifacts(ctx), name=artifact_name)
        if artifact is None:
            raise Exit(
                f"No downloadable '{artifact_name}' artifact found "
                "(none built yet, or all expired -- re-run CDPipeline for the windows target)."
            )
        run_id = artifact["workflow_run"]["id"]
        print(f"Using newest '{artifact_name}' artifact from run {run_id}")
    else:
        print(f"Using '{artifact_name}' artifact from run {run_id} (--run-id)")

    download_dir = release_dir / f"_store-package-{run_id}"
    shutil.rmtree(download_dir, ignore_errors=True)
    try:
        ctx.run(
            f"gh run download {_quote(run_id)} --repo {_quote(REPO_SLUG)} "
            f"-n {_quote(artifact_name)} --dir {_quote(download_dir)}"
        )
        store_packages = sorted(download_dir.rglob("*.appx")) + sorted(download_dir.rglob("*.msix"))
        if not store_packages:
            raise Exit(f"No .appx/.msix inside '{artifact_name}' (run {run_id}).")
        store_package = store_packages[0]
        found_version = parse_windows_store_package_version(store_package.name)
        if version and found_version != version:
            raise Exit(
                f"Fetched {store_package.name} (version {found_version}) != requested --version {version}. "
                "Pass the matching --run-id, or drop --version to accept this build."
            )
        if found_version != PROJECT_VERSION:
            print(f"  note: fetched version {found_version} differs from local VERSION ({PROJECT_VERSION})")

        target = release_dir / store_package.name
        shutil.copy2(store_package, target)
        print(f"  extracted: {target.name}")
        checksum_src = store_package.with_name(f"{store_package.name}.sha256")
        if checksum_src.exists():
            shutil.copy2(checksum_src, release_dir / checksum_src.name)
            expected = checksum_src.read_text(encoding="utf-8").strip().split()[0]
            actual = hashlib.sha256(target.read_bytes()).hexdigest()
            if actual != expected:
                raise Exit(f"Checksum mismatch for {target.name}: expected {expected}, got {actual}")
            print(f"  checksum OK ({actual[:12]}...)")
    finally:
        if keep:
            print(f"  kept raw download: {download_dir}")
        else:
            shutil.rmtree(download_dir, ignore_errors=True)

    print("")
    print(f"Ready: {target}")
    print("Next: Partner Center -> your app -> Packages -> upload this Store package -> Submit.")
    print("The Store re-signs it (no certificate needed); the version must exceed the last submission.")


namespace = Collection(
    show_help,
    clean,
    prepare,
    build,
    bundle,
    release,
    bump,
    commit_release,
    version_sync,
    publish_release,
    publish_meta,
    fetch_appx,
    tauri_win_store,
    update_demo_replay,
    update_screenshots,
    start,
    build_website,
    checksums,
    install_self_signed_appx,
    uninstall_self_signed_appx,
)
