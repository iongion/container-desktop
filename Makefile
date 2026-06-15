PROJECT_ROOT:=$(shell dirname $(abspath $(lastword $(MAKEFILE_LIST))))
TEMP_DIR:=$(PROJECT_ROOT)/temp
UV_VERSION:=0.6.11


.PHONY: clean prepare-python prepare-node prepare check format build-website

clean:
	@echo "Cleaning build artifacts"
	rm -fr bin build

prepare-python:
	@echo "Preparing the Python environment"
	@# Install uv only when it is missing. Avoids failing when an active uv-managed .venv has no pip.
	@command -v uv >/dev/null 2>&1 || python -m pip install --disable-pip-version-check "uv==$(UV_VERSION)"
	@# Unset VIRTUAL_ENV so uv always targets the project .venv, even when another venv is activated.
	env -u VIRTUAL_ENV uv sync --locked --dev --no-install-project

prepare-node:
	@echo "Preparing the Node.js environment"
	@# nvm is a shell function — it must be sourced from $$NVM_DIR before use. Source it when present
	@# (install the .nvmrc version if missing), then install deps with whatever node is on PATH.
	@if [ -s "$$NVM_DIR/nvm.sh" ]; then \
		. "$$NVM_DIR/nvm.sh"; \
		nvm use || nvm install; \
	fi; \
	yarn install --frozen-lockfile --production=false

prepare:
	@echo "Preparing the project - synchronizing dependencies - $(PROJECT_ROOT)"
	$(MAKE) prepare-python
	$(MAKE) prepare-node
	mkdir -p "$(TEMP_DIR)"

check:
	@echo "Checking the project"
	uv run --locked ruff check --fix tasks.py ./support ./tests

format:
	@echo "Formatting the project"
	uv run --locked ruff format tasks.py ./support ./tests
	yarn format

build-website:
	@echo "Building the website (website-src -> website)"
	rm -fr website
	yarn build:website
