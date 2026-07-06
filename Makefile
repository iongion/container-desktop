PROJECT_ROOT:=$(shell dirname $(abspath $(lastword $(MAKEFILE_LIST))))
TEMP_DIR:=$(PROJECT_ROOT)/temp
PART?=patch


.PHONY: clean prepare-node prepare check format build-website build-assets screenshots release test test-app trigger-cd-pipeline

clean:
	@echo "Cleaning build artifacts"
	rm -fr bin build

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
	$(MAKE) prepare-node
	mkdir -p "$(TEMP_DIR)"

check:
	@echo "Checking the project (Biome lint + fix, incl. support/cli)"
	yarn lint

format:
	@echo "Formatting the project (Biome, incl. support/cli)"
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

build-assets:
	$(MAKE) screenshots
	$(MAKE) build-website

trigger-cd-pipeline:
	@V=$$(cat VERSION); echo "Triggering CDPipeline for $$V"; \
	gh workflow run CDPipeline.yml --ref main \
		-f git-ref=$$V -f stage=production -f target=all \
		-f publish-release=true -f replace-release=false

# Cut a release, keeping docs / static site / screenshots / demo videos in sync
# INSIDE the release commit. Runs the full local CI gate, bumps the version WITHOUT
# committing, regenerates the deterministic screenshots + demo replay and the static
# site from the mock backend, then commits/tags/pushes everything as one release
# commit and triggers the cloud pipeline for that tag. CDPipeline no longer rebuilds
# or commits the website — it just deploys the website/ committed here. Unlike
# `yarn cli release` (which builds/bundles locally), this drives the cloud pipeline that
# builds every OS target and publishes the GitHub release. Override the bump size with
# `make release PART=minor` (default: patch). Aborts if CHANGELOG.md [Unreleased] is
# empty, so document the release first.
release: test
	@echo "Releasing: bump ($(PART)) → build-assets → commit → trigger CDPipeline"
	@if [ -s "$$NVM_DIR/nvm.sh" ]; then . "$$NVM_DIR/nvm.sh"; nvm use || nvm install; fi; \
	yarn cli bump --part=$(PART) --perform --no-commit
	$(MAKE) build-assets
	@if [ -s "$$NVM_DIR/nvm.sh" ]; then . "$$NVM_DIR/nvm.sh"; nvm use || nvm install; fi; \
	yarn cli commit-release
	$(MAKE) trigger-cd-pipeline

# Run the same verification set as CIPipeline.yml, locally. The CLI unit tests, type-check and
# lint of support/cli all run inside test-app (yarn test:run / check-types / lint:check), so a
# single app job mirrors CI. Run `make prepare` first if dependencies are not installed.
test: test-app
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
