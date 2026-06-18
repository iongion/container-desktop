PROJECT_ROOT:=$(shell dirname $(abspath $(lastword $(MAKEFILE_LIST))))
TEMP_DIR:=$(PROJECT_ROOT)/temp
RELAY_DIR:=$(PROJECT_ROOT)/support/container-desktop-relay
UV_VERSION:=0.6.11
PART?=patch


.PHONY: clean prepare-python prepare-node prepare check format build-website demo-replay screenshots release test test-app test-relay test-tooling

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

screenshots:
	@echo "Regenerating website screenshots"
	@# nvm is a shell function — source it (as prepare-node does) so the .nvmrc node is used.
	@if [ -s "$$NVM_DIR/nvm.sh" ]; then \
		. "$$NVM_DIR/nvm.sh"; \
		nvm use || nvm install; \
	fi; \
	yarn screenshots

demo-replay:
	@echo "Regenerating website rrweb demo replay"
	@# nvm is a shell function — source it (as prepare-node does) so the .nvmrc node is used.
	@if [ -s "$$NVM_DIR/nvm.sh" ]; then \
		. "$$NVM_DIR/nvm.sh"; \
		nvm use || nvm install; \
	fi; \
	yarn demo:record

# Cut a release: first run the full local CI test gate, then bump the version
# (commit + tag + push) and trigger the GitHub CDPipeline for that tag. Unlike
# `inv release` (which builds/bundles locally), this drives the cloud pipeline
# that builds every OS target, publishes the GitHub release and — at the end —
# rebuilds and commits the website. Override the bump size with
# `make release PART=minor` (default: patch). The bump aborts if CHANGELOG.md
# [Unreleased] is empty, so document the release first.
release: test
	@echo "Releasing: bump ($(PART)) then trigger CDPipeline"
	uv run --locked invoke bump --part=$(PART) --perform
	@V=$$(cat VERSION); echo "Triggering CDPipeline for $$V"; \
	gh workflow run CDPipeline.yml --ref main \
		-f git-ref=$$V -f stage=production -f target=all \
		-f publish-release=true -f replace-release=false

# Run the same verification set as CIPipeline.yml, locally. Mirrors its three jobs:
# app (types/lint/tests/build), relay (Go) and tooling (Python). Run `make prepare`
# first if dependencies are not installed. The Go relay job also runs on Windows in
# CI (the SSH paths are //go:build windows) — that half can only be covered there.
test: test-app test-relay test-tooling
	@echo "All CI checks passed locally"

test-app:
	@echo "App — type-check, lint, unit tests, production build (like CIPipeline)"
	@# nvm is a shell function — source it (as prepare-node does) so the .nvmrc node is used.
	@if [ -s "$$NVM_DIR/nvm.sh" ]; then \
		. "$$NVM_DIR/nvm.sh"; \
		nvm use || nvm install; \
	fi; \
	yarn check-types && \
	yarn lint:check && \
	yarn test:run && \
	ENVIRONMENT=production yarn build

test-relay:
	@echo "Relay — go test ./... (like CIPipeline)"
	cd "$(RELAY_DIR)" && go test ./...

test-tooling:
	@echo "Tooling — ruff check (no fixes) + pytest (like CIPipeline)"
	uv run --locked ruff check tasks.py ./support ./tests
	uv run --locked pytest
