import os
from invoke import task

PROJECT_HOME = os.path.dirname(__file__)
PROJECT_CODE = "podman-desktop-companion"
PROJECT_VERSION = "3.4.2-alpha.2"
NODE_ENV = os.environ.get("NODE_ENV", "development")
REACT_APP_ENV = os.environ.get("REACT_APP_ENV", NODE_ENV)
REACT_APP_PROJECT_VERSION = PROJECT_VERSION
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
        "REACT_APP_ENV": REACT_APP_ENV,
        "REACT_APP_PROJECT_VERSION": REACT_APP_PROJECT_VERSION,
        "TARGET": TARGET,
    }


@task
def prepare(c, docs=False):
    c.run("npm install -g nodemon")
    c.run("npm install -g concurrently")
    with c.cd("packages/@podman-desktop-companion/container-client"):
        c.run("npm install")
    with c.cd("api"):
        c.run("npm install")
    with c.cd("app"):
        c.run("npm install")
    with c.cd("shell"):
        c.run("npm install")


@task
def build(c, docs=False):
    with c.cd("app"):
        c.run("npm run build", env=get_env())
    with c.cd("shell"):
        c.run("npm run build", env=get_env())


@task
def startapi(c, docs=False):
    with c.cd("api"):
        c.run("npm start", env=get_env())


@task
def startapp(c, docs=False):
    with c.cd("app"):
        c.run("npm start", env=get_env())


@task
def startshell(c, docs=False):
    with c.cd("shell"):
        c.run("npm start", env=get_env())
