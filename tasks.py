import json
import glob
import shutil
import hashlib
import platform
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from invoke import task, Collection

from support.versioning import (
    bump_version,
    promote_changelog,
    render_homebrew_rb,
    set_docs_version,
    set_manifest_version,
    set_package_json_version,
    set_plain_version,
)

PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "container-desktop"
PROJECT_VERSION = (
    Path(os.path.join(PROJECT_HOME, "VERSION")).read_text(encoding="utf-8").strip()
)
NODE_ENV = os.environ.get("NODE_ENV", "development")
ENVIRONMENT = os.environ.get("ENVIRONMENT", NODE_ENV)
APP_PROJECT_VERSION = PROJECT_VERSION
TARGET = os.environ.get("TARGET", "linux")
PORT = int(os.environ.get("PORT", str(3000)))
PTY = os.name != "nt"


def url_download(url, path):
    url = url
    output_file = path
    with urllib.request.urlopen(url) as response, open(output_file, "wb") as out_file:
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
        # "DEBUG": "electron-builder"
        # Global
        "ENVIRONMENT": ENVIRONMENT,
        "APP_PROJECT_VERSION": APP_PROJECT_VERSION,
    }


def run_env(ctx, cmd, env=None):
    cmd_env = {**get_env(), **({} if env is None else env)}
    nvm_dir = os.getenv("NVM_DIR", str(Path.home().joinpath(".nvm")))
    nvm_sh = os.path.join(nvm_dir, "nvm.sh")
    # print("ENVIRONMENT", cmd_env)
    if os.path.exists(nvm_sh):
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
                print(
                    f"Appx already installed: {app['Name']} - removing {app['PackageFullName']}"
                )
                ctx.run(
                    f'powershell.exe -Command "Remove-AppxPackage -Package \\"{app["PackageFullName"]}\\""'
                )
    except:
        print("Unable to parse appx list")


@task
def install_self_signed_appx(ctx):
    # See https://ebourg.github.io for jsign-6.0.jar
    # See https://gist.github.com/steve981cr/52ca0ae39403dba73a7dbdbe5d231bbf
    # See https://gist.github.com/steve981cr/4d592c5cc0f4600d2dc11b1b55aa62a7
    # See https://www.briggsoft.com/signgui.htm
    # Create self-signed certificate
    # New-SelfSignedCertificate -Type CodeSigning -Subject "CN=52408AA8-2ECC-4E48-9A2C-6C1F69841C79" -KeyUsage DigitalSignature -FriendlyName "Container Desktop" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    # Export without password
    # $cert = @(Get-ChildItem -Path 'Cert:\CurrentUser\My\821E07AB166C20273197EF17569D4613ACE31E4E')[0]; $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx); [System.IO.File]::WriteAllBytes('ContainerDesktop.pfx', $certBytes)
    # Find if appx is already installed
    uninstall_self_signed_appx(ctx)
    # Generate and import certificate if not found
    path = Path(PROJECT_HOME)
    pfx_path = os.path.join(path, "temp/self-signed.pfx")
    if not os.path.exists(pfx_path):
        print("Certificate not found - generating")
        # ctx.run(f'powershell.exe -Command "{command_gen_cert} | ConvertTo-Json"')
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
            ctx.run(
                f"openssl req -new -key {private_key_path} -out {csr_path} -config {cert_config_path}"
            )
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
    exe_path = os.path.join(
        path, "release", f"container-desktop-x64-{PROJECT_VERSION}.exe"
    )
    appx_path = os.path.join(
        path, "release", f"container-desktop-x64-{PROJECT_VERSION}.appx"
    )
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
        for file in glob.glob("./src/resources/icons/appIcon*"):
            shutil.copy(file, "./build")
        for file in glob.glob("./src/resources/icons/trayIcon*"):
            shutil.copy(file, "./build")


@task
def build_relay(ctx, env=None):
    path = Path(PROJECT_HOME)
    relay_dir = os.path.join(path, "support/container-desktop-relay")
    with ctx.cd(relay_dir):
        os.makedirs(os.path.join(PROJECT_HOME, "bin"), exist_ok=True)
        system = platform.system()
        print(f"Building relay on {system}")
        if system == "Linux":
            run_env(ctx, f'cd "{relay_dir}" && ./relay-build.sh', env)
        elif system == "Windows":
            run_env(ctx, "relay-build.cmd", env)
            for file in glob.glob(os.path.join(relay_dir, "bin", "**")):
                shutil.copy(file, os.path.join(path, "bin"))
        else:
            raise Exception(f"Unsupported system: {system}")


@task
def bundle(ctx, env=None):
    system = platform.system()
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        env["DEBUG"] = "*"
        if system == "Darwin":
            run_env(ctx, "yarn package:mac_x86", env)
            run_env(ctx, "yarn package:mac_arm", env)
        elif system == "Linux":
            run_env(ctx, "yarn package:linux_x86", env)
            run_env(ctx, "yarn package:linux_arm", env)
        else:
            build_relay(ctx, env)
            run_env(ctx, "yarn package:win_x86", env)


@task
def checksums(ctx, env=None):
    items = glob.glob(os.path.join(PROJECT_HOME, "release", "container-desktop-*"))
    for installer_path in items:
        if installer_path.endswith(".sha256"):
            continue
        checksum_path = f"{installer_path}.sha256"
        print(f"Creating checksum for {installer_path}")
        file_contents = open(installer_path, "rb").read()
        checksum = hashlib.sha256(file_contents).hexdigest()
        with open(checksum_path, "w", encoding="utf-8") as fp:
            fp.write(checksum)


@task(default=True)
def help(ctx):
    ctx.run("invoke --list")


@task
def prepare(ctx, docs=False):
    # Install infrastructure dependencies
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, "npm install -g yarn@latest rimraf@latest")
        run_env(ctx, "yarn install")


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


@task
def bump(ctx, part="patch", perform=False):
    """Bump the version everywhere and (with --perform) commit, tag and push.

    Increments package.json by --part (patch|minor|major), updates VERSION and
    the web manifest, and promotes the CHANGELOG [Unreleased] section.
    """
    current = read_source_version()
    version = bump_version(current, part)
    print(f"Bump {current} -> {version} ({part})" + ("" if perform else "  (dry-run; pass --perform)"))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    targets = _synced_targets(version)
    targets.append(("CHANGELOG.md", promote_changelog(_read_text("CHANGELOG.md"), version, today)))
    _apply(targets, perform)
    if not perform:
        print("Re-run with --perform to write files, commit, tag and push.")
        return
    with ctx.cd(PROJECT_HOME):
        ctx.run("git add -A")
        ctx.run(f'git commit -m "Release {version}"')
        ctx.run(f'git tag -a "{version}" -m "{version}"')
        ctx.run("git push")
        ctx.run("git push --tags")


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


def _artifact_sha256(version, arch):
    name = f"container-desktop-{arch}-{version}.dmg.sha256"
    local = os.path.join(PROJECT_HOME, "release", name)
    if os.path.exists(local):
        return Path(local).read_text(encoding="utf-8").strip().split()[0]
    url = f"https://github.com/{REPO_SLUG}/releases/download/{version}/{name}"
    with urllib.request.urlopen(url) as response:
        return response.read().decode("utf-8").strip().split()[0]


@task(name="publish-meta")
def publish_meta(ctx, version=None, perform=False):
    """Render docs + homebrew cask for a PUBLISHED release (defaults to latest).

    Points the docs download page and homebrew cask at a real, downloadable
    release. Homebrew sha256 values come from release/ if present, else from the
    published GitHub release. Prints the plan unless --perform is given.
    """
    version = version or _latest_release_version(ctx)
    print(f"Render published metadata for {version}" + ("" if perform else "  (dry-run; pass --perform)"))
    targets = [
        ("docs/index.html", set_docs_version(_read_text("docs/index.html"), version)),
        ("docs/VERSION", set_plain_version(_read_text("docs/VERSION"), version)),
        ("docs/VERSION-Windows_NT", set_plain_version(_read_text("docs/VERSION-Windows_NT"), version)),
    ]
    _apply(targets, perform)
    rb = "support/homebrew-cask/container-desktop.rb"
    if perform:
        sha_arm = _artifact_sha256(version, "arm64")
        sha_intel = _artifact_sha256(version, "x64")
        _write_text(rb, render_homebrew_rb(_read_text(rb), version, sha_arm, sha_intel))
        print(f"  updated: {rb}")
    else:
        print(f"  would update: {rb} (fetch dmg sha256 for arm64 + x64)")


namespace = Collection(
    clean,
    prepare,
    build,
    build_relay,
    bundle,
    release,
    bump,
    version_sync,
    publish_meta,
    start,
    checksums,
    install_self_signed_appx,
    uninstall_self_signed_appx,
)
