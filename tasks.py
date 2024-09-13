import glob
import shutil
import hashlib
import platform
import os
from pathlib import Path

from invoke import task, Collection

PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "container-desktop"
PROJECT_VERSION = Path(os.path.join(PROJECT_HOME, "VERSION")).read_text(encoding="utf-8").strip()
NODE_ENV = os.environ.get("NODE_ENV", "development")
ENVIRONMENT = os.environ.get("ENVIRONMENT", NODE_ENV)
APP_PROJECT_VERSION = PROJECT_VERSION
TARGET = os.environ.get("TARGET", "linux")
PORT = int(os.environ.get("PORT", str(3000)))
PTY = os.name != "nt"
SIGNTOOL_PATH = os.environ.get("SIGNTOOL_PATH", "")

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
        "SIGNTOOL_PATH": SIGNTOOL_PATH
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
def gen_sign(ctx):
    # See https://ebourg.github.io for jsign-6.0.jar
    # See https://gist.github.com/steve981cr/52ca0ae39403dba73a7dbdbe5d231bbf
    # See https://gist.github.com/steve981cr/4d592c5cc0f4600d2dc11b1b55aa62a7
    # See https://www.briggsoft.com/signgui.htm
    # Create self-signed certificate
    # New-SelfSignedCertificate -Type CodeSigning -Subject "CN=52408AA8-2ECC-4E48-9A2C-6C1F69841C79" -KeyUsage DigitalSignature -FriendlyName "Container Desktop" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    # Export without password
    # $cert = @(Get-ChildItem -Path 'Cert:\CurrentUser\My\61A96AA84FAA9EE846F176E0C40B32D364A0DEE6')[0]; $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx); [System.IO.File]::WriteAllBytes('PodmanDesktopCompanion.pfx', $certBytes)
    path = Path(PROJECT_HOME)
    cert_path = os.path.join(path, "PodmanDesktopCompanion.pfx")
    cert_gen = "$cert = @(Get-ChildItem -Path 'Cert:\\CurrentUser\\My\\61A96AA84FAA9EE846F176E0C40B32D364A0DEE6')[0]; $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx); [System.IO.File]::WriteAllBytes('PodmanDesktopCompanion.pfx', $certBytes)"
    if not os.path.exists(cert_path):
        print(f"Certificate not found at {cert_path} - generate with: {cert_gen}")
        return False
    jar_path = os.path.join(path, "temp/jsign-6.0.jar")
    ts_url = "as,http://timestamp.sectigo.com/rfc3161,http://timestamp.globalsign.com/scripts/timstamp.dll,http://timestamp.comodoca.com/authenticode,http://sha256timestamp.ws.symantec.com/sha256/timestamp"
    app_path = os.path.join(path, "release", f"container-desktop-x64-{PROJECT_VERSION}.exe")
    with ctx.cd(path):
        run_env(ctx, f'java -jar "{jar_path}" --keystore PodmanDesktopCompanion.pfx --storetype PKCS12 --storepass "" --alias te-421f6152-2313-4a73-85bf-29bae289dbd8 --tsaurl "{ts_url}" "{app_path}"')
    # "C:\Program Files (x86)\Windows
    #  Kits\10\bin\10.0.22000.0\x64\signtool.exe" sign /a /f "C:\Workspace\is\container-desktop\PodmanDesktopCompanion.pfx" /tr "http://ts.ssl.com" /td sha256 /fd sha256 /v "C:\Workspace\is\container-desktop\release\container-desktop-x64-5.2.2-rc.7.appx"
    # appx_path = os.path.join(path, "release", f"container-desktop-x64-{PROJECT_VERSION}.appx")
    # with ctx.cd(path):
    #     run_env(ctx, f'java -jar "{jar_path}" --keystore PodmanDesktopCompanion.pfx --storetype PKCS12 --storepass "" --alias te-421f6152-2313-4a73-85bf-29bae289dbd8 --tsaurl "{ts_url}" "{appx_path}"')


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
def bundle(ctx, env=None):
    system = platform.system()
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        if system == "Darwin":
            run_env(ctx, "yarn package:mac_x86", env)
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
        shutil.rmtree("build", ignore_errors=True)
        shutil.rmtree("release", ignore_errors=True)



@task
def start(ctx, docs=False):
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        run_env(ctx, "yarn dev")


namespace = Collection(clean, prepare, build, bundle, release, start, checksums, gen_sign)
