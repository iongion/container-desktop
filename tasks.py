import platform
import os
from pathlib import Path

from invoke import task, Collection

PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "podman-desktop-companion"
PROJECT_VERSION = Path(os.path.join(PROJECT_HOME, "VERSION")).read_text().strip()
NODE_ENV = os.environ.get("NODE_ENV", "development")
REACT_APP_ENV = os.environ.get("REACT_APP_ENV", NODE_ENV)
REACT_APP_PROJECT_VERSION = PROJECT_VERSION
TARGET = os.environ.get("TARGET", "linux")
PORT = 5000


def run_env(ctx, cmd, env=None):
    cmd_env = {**get_env(), **({} if env is None else env)}
    nvm_dir = os.getenv("NVM_DIR", str(Path.home().joinpath(".nvm")))
    nvm_sh = os.path.join(nvm_dir, "nvm.sh")
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


def build_apps(ctx, env=None):
    with ctx.cd("src/app"):
        run_env(ctx, "rm -fr build", env)
        run_env(ctx, "rm -fr dist", env)
        run_env(ctx, "npm run build", env)
        run_env(ctx, "cp -R icons/appIcon.* build", env)


def bundle_apps(c, env=None):
    system = platform.system()
    with c.cd("src/app"):
        if system == "Darwin":
            run_env(c, "npm run package:mac_x86", env)
            run_env(c, "npm run package:mac_arm", env)
        elif system == "Linux":
            run_env(c, "npm run package:linux_x86", env)
            run_env(c, "npm run package:linux_arm", env)
        else:
            run_env(c, "npm run package:win_x86", env)


@task(default=True)
def help(c):
    c.run("invoke --list")


def get_env():
    return {
        "BROWSER": "none",
        "PORT": str(PORT),
        "PROJECT_HOME": PROJECT_HOME,
        "PROJECT_CODE": PROJECT_CODE,
        "PROJECT_VERSION": PROJECT_VERSION,
        "NODE_ENV": NODE_ENV,
        "REACT_APP_ENV": REACT_APP_ENV,
        "REACT_APP_PROJECT_VERSION": REACT_APP_PROJECT_VERSION,
        "TARGET": TARGET,
        "PUBLIC_URL": ".",
        # "DEBUG": "electron-builder"
        # "FAST_REFRESH": "false",
    }


@task
def prepare(c, docs=False):
    # Install infrastructure dependencies
    with c.cd(PROJECT_HOME):
        run_env(c, "npm install -g concurrently@7.0.0 nodemon@2.0.15 wait-on@6.0.0")
    # Install project dependencies
    path = Path(os.path.join(PROJECT_HOME, "packages/@podman-desktop-companion"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "npm install")
    path = Path(os.path.join(PROJECT_HOME, "src"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "npm install")


@task
def build(c, docs=False):
    build_apps(c)


@task
def bundle(c, docs=False):
    bundle_apps(c)


@task
def release(c, docs=False):
    env = {"NODE_ENV": "production", "REACT_APP_ENV": "production"}
    build_apps(c, env)
    bundle_apps(c, env)


@task
def clean(c, docs=False):
    # Clean project dependencies
    path = Path(os.path.join(PROJECT_HOME, "packages/@podman-desktop-companion"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "rm -fr node_modules")
    path = Path(os.path.join(PROJECT_HOME, "src"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "rm -fr node_modules dist build")


@task
def app_start(c, docs=False):
    with c.cd("src/app"):
        run_env(c, "npm start")


@task
def docs_start(c, docs=False):
    with c.cd("docs"):
        run_env(c, "python3 -m http.server --bind 127.0.0.1 8888")


@task
def shell_start(c, docs=False):
    run_env(c, f'wait-on "http://127.0.0.1:{PORT}/index.html"')
    with c.cd("src/app"):
        run_env(c, f"npm run start.shell")


@task
def start(c, docs=False):
    launcher = " ".join(
        [
            "concurrently",
            "-k",
            '"inv app.app-start"',
            '"inv shell.shell-start"',
            '"inv docs.docs-start"',
        ]
    )
    run_env(c, launcher)


app = Collection("app")
app.add_task(app_start)

shell = Collection("shell")
shell.add_task(shell_start)

docs = Collection("docs")
docs.add_task(docs_start)

namespace = Collection(clean, prepare, build, bundle, release, app, shell, docs, start)
