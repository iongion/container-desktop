PROJECT_ROOT:=$(shell dirname $(abspath $(lastword $(MAKEFILE_LIST))))
TEMP_DIR:=$(PROJECT_ROOT)/temp


.PHONY: clean prepare check format build-website

clean:
	@echo "Cleaning build artifacts"
	rm -fr bin build

prepare:
	@echo "Preparing the project - synchronizing dependencies - $(PROJECT_ROOT)"
	pip install --upgrade pip && pip install uv
	uv sync --dev --no-install-project
	mkdir -p "$(TEMP_DIR)"

check:
	@echo "Checking the project"
	uv run ruff check --fix ./support

format:
	@echo "Formatting the project"
	uv run ruff format ./support
	yarn format

build-website:
	@echo "Building the website (website-src -> website)"
	rm -fr website
	yarn build:website
