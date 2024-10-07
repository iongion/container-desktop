import subprocess
import json
import glob
import shutil
import hashlib
import platform
import os
import urllib.request
from pathlib import Path

from invoke import task, Collection

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
SIGNTOOL_PATH = os.environ.get("SIGNTOOL_PATH", "")


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
        "SIGNTOOL_PATH": SIGNTOOL_PATH,
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
    support_dir = os.path.join(path, "support")
    with ctx.cd(support_dir):
        os.makedirs(os.path.join(PROJECT_HOME, "bin"), exist_ok=True)
        system = platform.system()
        print(f"Building relay on {system}")
        if system == "Linux":
            run_env(ctx, f'cd "{support_dir}" && ./build-relay.sh', env)
        elif system == "Windows":
            run_env(ctx, f"wsl.exe --exec bash -i -l -c ./build-relay.sh", env)
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


namespace = Collection(
    clean,
    prepare,
    build,
    build_relay,
    bundle,
    release,
    start,
    checksums,
    install_self_signed_appx,
    uninstall_self_signed_appx,
)
