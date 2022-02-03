import os
from pathlib import Path

from invoke import task, Collection

PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "podman-desktop-companion"
PROJECT_VERSION = "3.4.2-alpha.2"
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
    # run_env(c, "npm install -g nodemon")
    # run_env(c, "npm install -g concurrently")
    # run_env(c, "npm install -g wait-on")
    with c.cd("packages/@podman-desktop-companion/container-client"):
        run_env(c, "npm install")
    with c.cd("packages/@podman-desktop-companion/executor"):
        run_env(c, "npm install")
    with c.cd("packages/@podman-desktop-companion/rpc"):
        run_env(c, "npm install")
    with c.cd("packages/@podman-desktop-companion/terminal"):
        run_env(c, "npm install")
    with c.cd("packages/@podman-desktop-companion/utils"):
        run_env(c, "npm install")
    with c.cd("api"):
        run_env(c, "npm install")
    with c.cd("app"):
        run_env(c, "npm install")
    with c.cd("shell"):
        run_env(c, "npm install")


@task
def build(c, docs=False):
    with c.cd("app"):
        run_env(c, "npm run build")
    with c.cd("shell"):
        run_env(c, "npm run build")


@task
def api_start(c, docs=False):
    with c.cd("api"):
        run_env(c, "npm start")


@task
def app_start(c, docs=False):
    with c.cd("app"):
        run_env(c, "npm start")


@task
def docs_start(c, docs=False):
    with c.cd("docs"):
        run_env(c, "python3 -m http.server --bind 127.0.0.1 8888")


@task
def shell_start(c, docs=False):
    print(f"Wait on http://127.0.0.1:{PORT}/index.html")
    # run_env(c, f'wait-on "http://127.0.0.1:{PORT}/index.html"')
    with c.cd("shell"):
        run_env(c, f"npm start")


@task
def start(c, docs=False):
    run_env(
        c,
        'concurrently "inv api.api-start" "inv app.app-start" "inv shell.shell-start" "inv docs.docs-start"',
    )


api = Collection("api")
api.add_task(api_start)

app = Collection("app")
app.add_task(app_start)

shell = Collection("shell")
shell.add_task(shell_start)

docs = Collection("docs")
docs.add_task(docs_start)

namespace = Collection(prepare, build, api, app, shell, docs, start)
