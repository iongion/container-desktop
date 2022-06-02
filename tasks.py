import platform
import os
from pathlib import Path

from invoke import task, Collection

PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "podman-desktop-companion"
PROJECT_VERSION = Path(os.path.join(PROJECT_HOME, "VERSION")).read_text().strip()
NODE_ENV = os.environ.get("NODE_ENV", "development")
APP_ENV = os.environ.get("APP_ENV", NODE_ENV)
APP_PROJECT_VERSION = PROJECT_VERSION
TARGET = os.environ.get("TARGET", "linux")
PORT = 5000


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
        "APP_ENV": APP_ENV,
        "APP_PROJECT_VERSION": APP_PROJECT_VERSION,
        # CRA
        "REACT_APP_ENV": APP_ENV,
        "REACT_APP_PROJECT_VERSION": APP_PROJECT_VERSION,
    }


def run_env(ctx, cmd, env=None):
    cmd_env = {**get_env(), **({} if env is None else env)}
    nvm_dir = os.getenv("NVM_DIR", str(Path.home().joinpath(".nvm")))
    nvm_sh = os.path.join(nvm_dir, "nvm.sh")
    # print("Environment", cmd_env)
    if os.path.exists(nvm_sh):
        with ctx.prefix(f'source "{nvm_dir}/nvm.sh"'):
            nvm_rc = os.path.join(ctx.cwd, ".nvmrc")
            if os.path.exists(nvm_rc):
                with ctx.prefix("nvm use"):
                    ctx.run(cmd, env=cmd_env)
            else:
                ctx.run(cmd, env=cmd_env)
    else:
        ctx.run(cmd, env=cmd_env)


@task
def app_build(ctx, env=None):
    path = Path(os.path.join(PROJECT_HOME, "packages/web-app"))
    with ctx.cd(path):
        run_env(ctx, "rm -fr build", env)
        run_env(ctx, "yarn run build", env)
        run_env(ctx, "mkdir -p ../electron-shell/build", env)
        run_env(ctx, "cp -R build/* ../electron-shell/build", env)


@task
def shell_build(ctx, env=None):
    path = Path(os.path.join(PROJECT_HOME, "packages/electron-shell"))
    with ctx.cd(path):
        run_env(ctx, "rm -fr build", env)
        run_env(ctx, "yarn build", env)
        run_env(ctx, "cp -R resources/icons/appIcon.* build", env)
        run_env(ctx, "cp -R resources/icons/trayIcon.* build", env)


def build_apps(ctx, env=None):
    shell_build(ctx, env)
    app_build(ctx, env)


@task
def shell_bundle(ctx, env=None):
    system = platform.system()
    path = Path(os.path.join(PROJECT_HOME, "packages/electron-shell"))
    with ctx.cd(path):
        if system == "Darwin":
            run_env(ctx, "yarn run package:mac_x86", env)
            run_env(ctx, "yarn run package:mac_arm", env)
        elif system == "Linux":
            run_env(ctx, "yarn run package:linux_x86", env)
            # run_env(ctx, "yarn run package:linux_arm", env)
        else:
            run_env(ctx, "yarn run package:win_x86", env)


@task(default=True)
def help(ctx):
    ctx.run("invoke --list")


@task
def prepare(ctx, docs=False):
    # Install infrastructure dependencies
    with ctx.cd(PROJECT_HOME):
        run_env(ctx, "yarn global add concurrently@7.0.0 nodemon@2.0.15 wait-on@6.0.0")
        run_env(ctx, "yarn install")


@task
def build(ctx, docs=False):
    build_apps(ctx)


@task
def bundle(ctx, docs=False):
    shell_bundle(ctx)


@task
def release(ctx, docs=False):
    env = {
        "NODE_ENV": "production",
        "APP_ENV": "production",
        "REACT_APP_ENV": "production",
    }
    build_apps(ctx, env)
    shell_bundle(ctx, env)


@task
def clean(c, docs=False):
    # Clean project dependencies
    path = Path(os.path.join(PROJECT_HOME, "packages"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "rm -fr node_modules")
    path = Path(os.path.join(PROJECT_HOME, "src"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "rm -fr node_modules dist build")


@task
def app_start(ctx, docs=False):
    path = Path(os.path.join(PROJECT_HOME, "packages/web-app"))
    with ctx.cd(path):
        run_env(ctx, "yarn start")


@task
def docs_start(c, docs=False):
    path = Path(os.path.join(PROJECT_HOME, "docs"))
    with c.cd(path):
        run_env(c, "python3 -m http.server --bind 127.0.0.1 8888")


@task
def shell_start(ctx, docs=False):
    path = Path(os.path.join(PROJECT_HOME, "packages/electron-shell"))
    run_env(ctx, f'wait-on "http://127.0.0.1:{PORT}/index.html"')
    with ctx.cd(path):
        run_env(ctx, f"yarn run build")
        run_env(ctx, f"yarn run start")


@task
def start(ctx, docs=False):
    launcher = " ".join(
        [
            "concurrently",
            "-k",
            '"inv app.app-start"',
            '"inv shell.shell-start"',
            '"inv docs.docs-start"',
        ]
    )
    run_env(ctx, launcher)


app = Collection("app")
app.add_task(app_start)
app.add_task(app_build)

shell = Collection("shell")
shell.add_task(shell_start)
shell.add_task(shell_build)
shell.add_task(shell_bundle)

docs = Collection("docs")
docs.add_task(docs_start)

namespace = Collection(clean, prepare, build, bundle, release, app, shell, docs, start)
