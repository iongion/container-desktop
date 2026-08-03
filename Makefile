PROJECT_ROOT:=$(shell dirname $(abspath $(lastword $(MAKEFILE_LIST))))
TEMP_DIR:=$(PROJECT_ROOT)/temp
PART?=patch

# core/rust resource ceilings. Cargo takes every core by default and `cargo mutants` multiplies that
# by its worker count, which is how a mutation run starves the desktop it is running on. Both are
# capped here rather than in each command, and every knob is overridable:
#   make mutation MUTATION_JOBS=8      # a machine with room to spare
#   make test-core CDC_TEST_GUARD=0    # no cgroup available (CI, macOS)
CORE_JOBS?=8
MUTATION_JOBS?=4
MUTATION_MEM_MAX?=24G
MUTATION_SWAP_MAX?=0
MEM_GUARD?=$(PROJECT_ROOT)/core/rust/mk/mem-guard.sh
MUTATION_TMPDIR?=$(PROJECT_ROOT)/core/rust/target/mutants/tmp
# `src/main.rs` is excluded for every binary rather than named one at a time: a binary's `main` cannot
# be entered from an integration test at all, which is why each of them is wiring and every decision
# lives in the crate's library. The model is the hand-written declarations — but its modules are named
# ONE AT A TIME rather than as `domain/types/`, and FOUR of them are deliberately absent because they
# carry a rule rather than a shape: `diagnostic.rs` (an unrecognised code is kept rather than refused),
# `container.rs` (`is_running`, and which of the two `State` shapes answers), `pod.rs` (`is_running`)
# and `types.rs` itself (`null_default` — a `null` where a collection was expected). A wildcard would
# have hidden all four. Keep this list and `core/rust/.cargo/mutants.toml`'s `exclude_globs` a pair.
# `-- --test-threads=1` is part of the DEFAULT so the gate is `make coverage-core` and nothing else:
# an override that had to restate the regex is an override that drifted from the pair above, and
COVERAGE_ARGS?=--workspace --show-missing-lines --ignore-filename-regex 'domain/types/(command_proxy_protocol|connection|engine|host|image|machine|network|os|registry|resource_sync_protocol|secret|security|swarm|system|user_settings|volume)\.rs|src/main\.rs' --fail-under-lines 99 -- --test-threads=1

.PHONY: clean prepare-node prepare check format build-website build-assets screenshots release test test-app test-core coverage-core mutation trigger-cd-pipeline

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
	@V=$$(cat VERSION); echo "Triggering CDPipeline.Tauri for $$V"; \
	gh workflow run CDPipeline.Tauri.yml --ref main \
		-f git-ref=$$V -f stage=production -f target=all \
		-f publish-release=true -f replace-release=false

# Cut a release, keeping docs / static site / screenshots / demo videos in sync
# INSIDE the release commit. Runs the full local CI gate, bumps the version WITHOUT
# committing, regenerates the deterministic screenshots + demo replay and the static
# site from the mock backend, then commits/tags/pushes everything as one release
# commit and triggers the cloud pipeline for that tag. CDPipeline.Tauri no longer rebuilds
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

# core/rust — the connection runtime. `test-core` is the whole set; `wasm` is separate because it is
# what proves cdc-runtime still has no host: the workspace build cannot show that, since features
# unify across it and a host crate's tokio/process would be enabled for the runtime too.
#
# One guarded scope around the whole chain, not four — the ceiling is what the run as a whole must
# stay under, and a per-command scope would let each one have it again.
test-core:
	@echo "core/rust — fmt, clippy, tests, docs, and the runtime compiled without a host"
	cd core/rust && CARGO_BUILD_JOBS=$(CORE_JOBS) "$(MEM_GUARD)" sh -c '\
	  cargo fmt --all --check && \
	  cargo clippy --workspace --all-targets --all-features -- -D warnings && \
	  cargo test --workspace && \
	  RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps --document-private-items && \
	  cargo check --package cdc-runtime --no-default-features \
	    --target wasm32-unknown-unknown --target-dir target/wasm-gate --locked'

# Line coverage. The shape-only modules of `domain/types/` are excluded because they are serde derives
# with no behaviour, and counting them drags the whole workspace under the gate. The modules that carry
# a RULE are not excluded — see COVERAGE_ARGS above for which four and why.
coverage-core:
	@echo "core/rust — line coverage"
	cd core/rust && CARGO_BUILD_JOBS=$(CORE_JOBS) "$(MEM_GUARD)" \
	  cargo llvm-cov $(COVERAGE_ARGS)

# Mutation score — the guard that a green suite is actually a suite.
#
# `--jobserver-tasks` is the one that matters, and it is the ONLY job cap here: `--jobs` alone caps
# the number of WORKERS, and a `CARGO_BUILD_JOBS` on top would give each of them that many compile
# jobs again — measured at 82% IO-wait with the machine paging. TMPDIR is moved under target/ so a
# killed run leaves nothing in the system one, and cargo mutants SNAPSHOTS the tree when it starts —
# editing source while it runs makes its verdict describe a tree that no longer exists.
mutation:
	@echo "core/rust — mutation score ($(MUTATION_JOBS) jobs, $(MUTATION_MEM_MAX) ceiling)"
	@mkdir -p "$(MUTATION_TMPDIR)"
	cd core/rust && \
	CDC_TEST_MEM_MAX="$(MUTATION_MEM_MAX)" CDC_TEST_SWAP_MAX="$(MUTATION_SWAP_MAX)" \
	TMPDIR="$(MUTATION_TMPDIR)" "$(MEM_GUARD)" \
	  cargo mutants --jobs $(MUTATION_JOBS) --jobserver-tasks $(MUTATION_JOBS) \
	    --output target/mutants

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
