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
    }


@task
def prepare(c, docs=False):
    # Install infrastructure dependencies
    with c.cd(PROJECT_HOME):
        run_env(c, "npm install -g concurrently@7.0.0 nodemon@2.0.15 wait-on@6.0.0")
    # Install project dependencies
    path = Path(os.path.join(PROJECT_HOME, "packages"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "npm install")
    path = Path(os.path.join(PROJECT_HOME, "src"))
    for p in path.glob("*/package.json"):
        with c.cd(os.path.dirname(p)):
            run_env(c, "npm install")


@task
def build(c, docs=False):
    with c.cd("src/app"):
        run_env(c, "npm run build")
        run_env(c, "cp -R build ../shell/build")
    with c.cd("src/shell"):
        run_env(c, "cp -R public/* build")
        run_env(c, "cp -R icons/appIcon.* build")


@task
def bundle(c, docs=False):
    with c.cd("src/shell"):
        run_env(c, "npm run electron:package:linux_x86")
        run_env(c, "npm run electron:package:linux_arm")


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
def api_start(c, docs=False):
    with c.cd("src/api"):
        run_env(c, "npm start")


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
    with c.cd("src/shell"):
        run_env(c, f"npm start")


@task
def start(c, docs=False):
    run_env(
        c,
        """
        concurrently -k \
            "inv api.api-start" \
            "inv app.app-start" \
            "inv shell.shell-start" \
            "inv docs.docs-start"
        """,
    )


api = Collection("api")
api.add_task(api_start)

app = Collection("app")
app.add_task(app_start)

shell = Collection("shell")
shell.add_task(shell_start)

docs = Collection("docs")
docs.add_task(docs_start)

namespace = Collection(clean, prepare, build, bundle, api, app, shell, docs, start)
