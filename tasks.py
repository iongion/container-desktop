import glob
import hashlib
import json
import os
import platform
import shlex
import shutil
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from invoke import Collection, Exit, task

from support.ci_artifacts import (
    WINDOWS_ARTIFACT_NAME,
    parse_appx_version,
    select_windows_artifact,
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
            shutil.copy(exe_path, f"{appx_path}.unsigned")
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
    system = platform.system()
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        env = {} if env is None else env
        env["DEBUG"] = "*"
        if system == "Darwin":
            run_env(ctx, "yarn package:mac_arm", env)
        elif system == "Linux":
            run_env(ctx, "yarn package:linux_x86", env)
            run_env(ctx, "yarn package:linux_arm", env)
        else:
            run_env(ctx, "yarn package:win_x86", env)


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
    build(ctx, env)
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


# --- versioning & release metadata ----------------------------------------
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
        f"{PROJECT_CODE}-x64-{version}.exe",
        f"{PROJECT_CODE}-x64-{version}.exe.sha256",
        f"{PROJECT_CODE}-x64-{version}.appx",
        f"{PROJECT_CODE}-x64-{version}.appx.sha256",
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
def fetch_appx(ctx, run_id=None, version=None, keep=False):
    """Download the Microsoft Store .appx from a CDPipeline run (no local build).

    The Windows CD job builds container-desktop-x64-<version>.appx but keeps it
    OFF the public GitHub release (there it is superseded by the signed installer +
    portable zip), so it only lives inside that run's `container-desktop-windows`
    upload artifact. This fetches that artifact with `gh`, extracts just the .appx
    (+ .sha256), verifies the checksum and drops it in release/ -- ready to upload
    to Partner Center. Runs on macOS/Linux: no Windows or build toolchain needed,
    only an authenticated `gh` CLI.

    Defaults to the newest non-expired windows artifact. Pass --run-id to target a
    specific run (`gh run list --workflow CDPipeline.yml`), or --version to assert
    the fetched build matches (errors on mismatch instead of silently guessing).
    Pass --keep to leave the raw download dir in place for inspection.
    """
    release_dir = _release_dir()
    if run_id is None:
        artifact = select_windows_artifact(_repo_artifacts(ctx))
        if artifact is None:
            raise Exit(
                f"No downloadable '{WINDOWS_ARTIFACT_NAME}' artifact found "
                "(none built yet, or all expired -- re-run CDPipeline for the windows target)."
            )
        run_id = artifact["workflow_run"]["id"]
        print(f"Using newest '{WINDOWS_ARTIFACT_NAME}' artifact from run {run_id}")
    else:
        print(f"Using '{WINDOWS_ARTIFACT_NAME}' artifact from run {run_id} (--run-id)")

    download_dir = release_dir / f"_appx-{run_id}"
    shutil.rmtree(download_dir, ignore_errors=True)
    try:
        ctx.run(
            f"gh run download {_quote(run_id)} --repo {_quote(REPO_SLUG)} "
            f"-n {_quote(WINDOWS_ARTIFACT_NAME)} --dir {_quote(download_dir)}"
        )
        appx_files = sorted(download_dir.rglob("*.appx"))
        if not appx_files:
            raise Exit(f"No .appx inside '{WINDOWS_ARTIFACT_NAME}' (run {run_id}).")
        appx = appx_files[0]
        found_version = parse_appx_version(appx.name)
        if version and found_version != version:
            raise Exit(
                f"Fetched {appx.name} (version {found_version}) != requested --version {version}. "
                "Pass the matching --run-id, or drop --version to accept this build."
            )
        if found_version != PROJECT_VERSION:
            print(f"  note: fetched version {found_version} differs from local VERSION ({PROJECT_VERSION})")

        target = release_dir / appx.name
        shutil.copy2(appx, target)
        print(f"  extracted: {target.name}")
        checksum_src = appx.with_name(f"{appx.name}.sha256")
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
    print("Next: Partner Center -> your app -> Packages -> upload this .appx -> Submit.")
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
    update_demo_replay,
    update_screenshots,
    start,
    build_website,
    checksums,
    install_self_signed_appx,
    uninstall_self_signed_appx,
)
