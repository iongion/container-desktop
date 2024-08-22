import glob
import shutil
import hashlib
import platform
import os
from pathlib import Path

from invoke import task, Collection

PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "podman-desktop-companion"
PROJECT_VERSION = Path(os.path.join(PROJECT_HOME, "VERSION")).read_text(encoding="utf-8").strip()
NODE_ENV = os.environ.get("NODE_ENV", "development")
ENVIRONMENT = os.environ.get("ENVIRONMENT", NODE_ENV)
APP_PROJECT_VERSION = PROJECT_VERSION
TARGET = os.environ.get("TARGET", "linux")
PORT = int(os.environ.get("PROT", str(3000)))


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
                    ctx.run(cmd, env=cmd_env, pty=True)
            else:
                ctx.run(cmd, env=cmd_env, pty=True)
    else:
        ctx.run(cmd, env=cmd_env, pty=True)



@task
def build(ctx, env=None):
    path = Path(PROJECT_HOME)
    with ctx.cd(path):
        shutil.rmtree("build", ignore_errors=True)
        run_env(ctx, "yarn build", env)
        for file in glob.glob("./src/resources/icons/appIcon.*"):
            shutil.copy(file, "./build")
        for file in glob.glob("./src/resources/icons/trayIcon.*"):
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
    items = glob.glob(os.path.join(PROJECT_HOME, "release", "podman-desktop-companion-*"))
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


namespace = Collection(clean, prepare, build, bundle, release, start, checksums)
